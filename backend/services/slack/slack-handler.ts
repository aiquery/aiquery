import crypto from 'crypto';
import axios from 'axios';
import { thirdPartyService } from '../connection/third-party-service';
import { truncateSlackMrkdwn } from './slack-block-utils';
import { buildUploadedTabularContext } from './uploaded-tabular-context';

interface SlackEvent {
  type: string;
  text?: string;
  channel?: string;
  user?: string;
  ts?: string;
  event_ts?: string;
  files?: Array<{
    name?: string;
    url_private_download?: string;
    url_private?: string;
  }>;
}

interface SlackChallenge {
  token: string;
  challenge: string;
  type: string;
}

function normalizeSlackExecutionSteps(raw: any): Array<{ title: string; detail?: string }> {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((step: any) => {
      const title = typeof step?.title === 'string' ? step.title.trim() : '';
      const detail = typeof step?.detail === 'string' ? step.detail.trim() : '';
      if (!title) return null;
      return { title, detail: detail || undefined };
    })
    .filter((step): step is { title: string; detail?: string } => Boolean(step));
}

function normalizeSlackFollowUpQuestions(raw: any): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((q: any) => (typeof q === 'string' ? q.trim() : ''))
    .filter((q) => q.length > 0)
    .slice(0, 4);
}

// Cache bot user IDs to avoid repeated API calls
const botUserIdCache = new Map<number, string>();

/**
 * Verify Slack request signature
 */
export function verifySlackSignature(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  try {
    // Validate timestamp (Slack requires requests to be within 5 minutes)
    const requestTime = parseInt(timestamp, 10);
    const currentTime = Math.floor(Date.now() / 1000);
    const timeDiff = Math.abs(currentTime - requestTime);
    
    if (timeDiff > 300) { // 5 minutes in seconds
      console.warn(`⚠️ Slack request timestamp is too old: ${timeDiff} seconds`);
      return false;
    }

    // Validate signature format
    if (!signature.includes('=')) {
      console.warn('⚠️ Invalid Slack signature format (missing =)');
      return false;
    }

    const [version, hash] = signature.split('=');
    if (!version || !hash) {
      console.warn('⚠️ Invalid Slack signature format (missing version or hash)');
      return false;
    }

    const baseString = `${version}:${timestamp}:${body}`;
    const hmac = crypto.createHmac('sha256', signingSecret);
    hmac.update(baseString);
    const computedSignature = `${version}=${hmac.digest('hex')}`;
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature)
    );
  } catch (error) {
    console.error('❌ Error verifying Slack signature:', error);
    return false;
  }
}

/**
 * Handle Slack URL verification challenge
 */
export function handleSlackChallenge(challenge: SlackChallenge, verificationToken: string): string | null {
  if (challenge.token === verificationToken && challenge.type === 'url_verification') {
    return challenge.challenge;
  }
  return null;
}

/**
 * Process Slack event and return response
 */
export async function processSlackEvent(
  event: SlackEvent,
  userId: number,
  apiBaseUrl: string
): Promise<{ text: string; blocks?: any[] }> {
  // Standalone file upload (no message body) — Slack sends `file_shared` separately from `message`.
  if (event.type === 'file_shared') {
    const fileId = (event as any).file_id as string | undefined;
    const responseId = `slack_file_notice_${event.event_ts || event.ts || Date.now()}`;
    const responseCache = (global as any).slackResponseCache || new Map();
    (global as any).slackResponseCache = responseCache;
    responseCache.set(responseId, {
      userId,
      fileId,
      timestamp: Date.now(),
    });

    return {
      text:
        '📎 I received a file upload. To analyze it, please *include your question in the same message as the file*, or send a follow-up message with what you want to know (I’ll use your connected data warehouse together with the file when you ask).',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text:
              '📎 I received a file upload. To analyze it, please *include your question in the same message as the file*, or send a follow-up message with what you want to know (I’ll use your connected data warehouse together with the file when you ask).',
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: '🗑️ Delete File',
              },
              action_id: `delete_uploaded_file_${responseId}`,
              value: responseId,
              style: 'danger',
            },
          ],
        },
      ],
    };
  }

  // Only process channel/DM message events
  if (event.type !== 'message') {
    return { text: '' };
  }

  // CRITICAL: Ignore bot messages to prevent infinite loops
  // Check for bot_id (present when message is from a bot)
  if ((event as any).bot_id) {
    console.log('🚫 Ignoring bot message (bot_id present)');
    return { text: '' };
  }

  // Check for bot_message subtype
  if ((event as any).subtype === 'bot_message') {
    console.log('🚫 Ignoring bot message (subtype: bot_message)');
    return { text: '' };
  }

  // Check if message has a user field (bot messages often don't have user field)
  // But also check if it's from our own bot by getting bot user ID
  const slackConfig = await getSlackConfigForUser(userId);
  if (slackConfig && slackConfig.config.apiToken) {
    try {
      // Check cache first
      let botUserId = botUserIdCache.get(userId);
      
      if (!botUserId) {
        // Get bot info to check if message is from our bot
        const botInfoResponse = await axios.post('https://slack.com/api/auth.test', {}, {
          headers: {
            'Authorization': `Bearer ${slackConfig.config.apiToken}`,
            'Content-Type': 'application/json'
          }
        });

        if (botInfoResponse.data && botInfoResponse.data.user_id) {
          botUserId = botInfoResponse.data.user_id;
          if (botUserId) {
            botUserIdCache.set(userId, botUserId);
          }
        }
      }
      
      // If the event user matches our bot's user ID, ignore it
      if (botUserId && event.user === botUserId) {
        console.log('🚫 Ignoring message from our own bot (user ID match)');
        return { text: '' };
      }
    } catch (error) {
      // If we can't get bot info, continue but log warning
      console.warn('⚠️ Could not verify bot user ID, continuing anyway');
    }
  }
  
  // Additional check: if event doesn't have a user field, it's likely a bot message
  if (!event.user) {
    console.log('🚫 Ignoring message without user field (likely bot message)');
    return { text: '' };
  }

  const hasAttachedFiles = Array.isArray(event.files) && event.files.length > 0;
  const question = (event.text || '').trim();
  
  // Ignore empty messages that have no file attachments
  if (!question && !hasAttachedFiles) {
    return { text: '' };
  }

  // CRITICAL: Ignore messages that contain our own error/thinking messages to prevent infinite loops
  // This happens when Slack sends events for messages we post/update
  if (question.includes('❌ Error') || 
      question.includes('No response was generated') ||
      question.includes('🤔 Thinking...') ||
      question.includes('Thinking...')) {
    console.log('🚫 Ignoring message that appears to be from our bot (contains error/thinking text)');
    return { text: '' };
  }

  try {
    // Get user info for the chat API - this ensures we use the correct user's RAG folder
    const user = await import('../user_account/user-service').then(m => m.userService.getUserById(userId));
    const userName = user?.name || user?.email || 'User';
    console.log(`👤 Using RAG for user ${userId} (${userName})`);
    let questionForChat = question;
    if (!questionForChat && hasAttachedFiles) {
      questionForChat = 'Analyze the uploaded spreadsheet and answer based on this file.';
    }

    if (hasAttachedFiles && slackConfig?.config?.apiToken) {
      try {
        const uploadedContext = await buildUploadedTabularContext(event.files || [], slackConfig.config.apiToken);
        if (uploadedContext) {
          questionForChat = `${questionForChat}\n\n${uploadedContext}`;
          console.log(`📎 Added uploaded tabular context from ${event.files?.length || 0} file(s)`);
        }
      } catch (fileContextError: any) {
        console.warn(`⚠️ Could not build uploaded file context: ${fileContextError?.message || 'Unknown error'}`);
      }
    }

    console.log(`💬 Processing Slack message: "${questionForChat}"`);

    // Call the chat API endpoint with userId - the API will build connectionConfig automatically
    // The API determines dataSourceType from connectionConfig structure
    let chatResponse;
    try {
      chatResponse = await axios.post(`${apiBaseUrl}/api/chat`, {
        question: questionForChat,
        userName,
        userId // Pass userId so the API can build connectionConfig and RAG is retrieved from this user's account
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });
      console.log(`✅ Chat API response received, status: ${chatResponse.status}`);
    } catch (axiosError: any) {
      console.error('❌ Error calling chat API:', axiosError.message);
      if (axiosError.response) {
        console.error('❌ Chat API error response:', axiosError.response.data);
      }
      return {
        text: `❌ Error calling chat API: ${axiosError.message || 'Unknown error'}`
      };
    }

    if (!chatResponse || !chatResponse.data) {
      console.error('❌ Chat API returned empty response');
      return {
        text: '❌ Error: Chat API returned empty response'
      };
    }

    const { interpretation, sqlQuery, queryResults, error } = chatResponse.data;
    const executionSteps = normalizeSlackExecutionSteps(chatResponse.data?.executionSteps);
    const followUpQuestions = normalizeSlackFollowUpQuestions(chatResponse.data?.followUpQuestions);
    console.log(`📋 Chat API response - interpretation: ${interpretation ? 'present' : 'missing'}, sqlQuery: ${sqlQuery ? 'present' : 'missing'}, queryResults: ${queryResults ? (Array.isArray(queryResults) ? `array(${queryResults.length})` : 'present') : 'missing'}, error: ${error || 'none'}`);

    if (error) {
      console.error('❌ Chat API returned error:', error);
      return {
        text: `❌ Error: ${error}`
      };
    }

    // Check if this is a greeting (no SQL query and no query results)
    // For greetings, just return the interpretation text without the query results wrapper
    if (!sqlQuery && (!queryResults || (Array.isArray(queryResults) && queryResults.length === 0))) {
      const greetingResponse = interpretation || 'Hello! How can I help you today?';
      console.log(`👋 Greeting detected, returning: "${greetingResponse}"`);
      return {
        text: greetingResponse
      };
    }

    // Store full response data temporarily for button interactions
    // Use event timestamp as unique identifier
    const responseId = event.ts || `${Date.now()}`;
    const responseCache = (global as any).slackResponseCache || new Map();
    (global as any).slackResponseCache = responseCache;
    
    responseCache.set(responseId, {
      interpretation,
      sqlQuery,
      queryResults,
      executionSteps,
      followUpQuestions,
      userId, // Store userId for run_sql and explain_sql (they will build connectionConfig from userId)
      timestamp: Date.now(),
      sqlVisible: false, // Track SQL visibility state
      csvVisible: true, // Track CSV visibility state (shown by default)
      csvExpanded: false, // Track CSV expanded state (collapsed by default)
      chartVisible: false, // Track chart visibility state
      chartGenerated: false, // Track if chart has been generated
      question: questionForChat, // Store for context (includes uploaded-file context when present)
      apiBaseUrl // Store for API calls
    });
    
    // Clean up old cache entries (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [key, value] of responseCache.entries()) {
      const cachedValue = value as any;
      if (cachedValue.timestamp < oneHourAgo) {
        responseCache.delete(key);
      }
    }

    // Helper function to convert a value to a CSV-safe string with float formatting
    const valueToCSVString = (value: any): string => {
      if (value === null || value === undefined) return '';
      
      // Handle Date objects
      if (value instanceof Date) {
        return value.toISOString().split('T')[0]; // Format as YYYY-MM-DD
      }
      
      // Format floats to 2 decimal places
      if (typeof value === 'number' && !Number.isInteger(value)) {
        return value.toFixed(2);
      }
      
      // Handle objects (including date-like objects from BigQuery)
      if (typeof value === 'object') {
        // Check if it's a date-like object with common date properties
        if (value.value && typeof value.value === 'string') {
          return value.value;
        }
        if (value.toString && value.toString !== Object.prototype.toString) {
          const str = value.toString();
          if (str !== '[object Object]') {
            return str;
          }
        }
        // Try to find a date string in common properties
        if (value.date) return String(value.date);
        if (value.timestamp) return String(value.timestamp);
        if (value.time) return String(value.time);
        // Last resort: try JSON stringify for nested objects
        try {
          return JSON.stringify(value);
        } catch {
          return '';
        }
      }
      
      return String(value);
    };

    // Helper function to format data as a table with grid lines
    const formatDataAsTable = (headers: string[], rows: any[], showAll: boolean = false): string => {
      const dataToShow = showAll ? rows : rows.slice(0, 5);
      
      // Calculate column widths
      const colWidths = headers.map(header => {
        let maxWidth = header.length;
        dataToShow.forEach(row => {
          const value = valueToCSVString(row[header] ?? '');
          if (value.length > maxWidth) {
            maxWidth = Math.min(value.length, 30); // Cap at 30 chars per column
          }
        });
        return maxWidth;
      });

      // Create separator line
      const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('+') + '+';
      
      // Create header row
      const headerRow = '|' + headers.map((h, i) => {
        const padded = h.padEnd(colWidths[i]);
        return ` ${padded} `;
      }).join('|') + '|';
      
      // Create data rows
      const dataRows = dataToShow.map(row => {
        return '|' + headers.map((h, i) => {
          const value = valueToCSVString(row[h] ?? '');
          const truncated = value.length > 30 ? value.substring(0, 27) + '...' : value;
          const padded = truncated.padEnd(colWidths[i]);
          return ` ${padded} `;
        }).join('|') + '|';
      });

      // Combine all parts
      const table = [
        separator,
        headerRow,
        separator,
        ...dataRows,
        separator
      ].join('\n');

      return table;
    };

    // Format response using Slack Block Kit - matching frontend layout
    const blocks: any[] = [];
    
    // 1. Response Section (always shown)
    if (interpretation) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSlackMrkdwn(`*Response:*\n${interpretation}`)
        }
      });
    }

    // Divider between Response and CSV Data Section (never first block — Slack rejects leading dividers)
    if (queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
      if (blocks.length > 0) {
        blocks.push({
          type: 'divider'
        });
      }
    }

    // 2. CSV Data Section
    if (queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
      // CSV Data Section Header
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*CSV Data Section*'
        }
      });

      // CSV Data Section Buttons (default to Hide CSV since csvVisible is true)
      // Using 'primary' style for primary actions in this section
      const dataButtons: any[] = [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🙈 Hide CSV'
          },
          action_id: `hide_csv_${responseId}`,
          value: responseId,
          style: 'primary' // Blue button for primary action
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📥 Download CSV'
          },
          action_id: `download_csv_${responseId}`,
          value: responseId
          // Default gray style for secondary action
        }
      ];
      
      blocks.push({
        type: 'actions',
        elements: dataButtons
      });

      // CSV Data Box (shown by default, collapsed by default)
      const headers = Object.keys(queryResults[0]);
      const csvExpanded = false; // Default to collapsed
      const displayResults = csvExpanded ? queryResults : queryResults.slice(0, 5);
      
      // Format as table with grid lines
      const tableText = formatDataAsTable(headers, queryResults, csvExpanded);
      
      let displayText = `*CSV Data:*\n\`\`\`\n${tableText}\n\`\`\`${!csvExpanded && queryResults.length > 5 ? `\n_Showing first 5 of ${queryResults.length} rows_` : csvExpanded ? `\n_Showing all ${queryResults.length} rows_` : ''}`;
      displayText = truncateSlackMrkdwn(displayText);

      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: displayText
        }
      });
      
      // Add "Show More/Less" button if there are more than 5 rows
      if (queryResults.length > 5) {
        blocks.push({
          type: 'actions',
          elements: [{
            type: 'button',
            text: {
              type: 'plain_text',
              text: '🔼 Show More'
            },
            action_id: `show_more_data_${responseId}`,
            value: responseId
          }]
        });
      }
    } else if (sqlQuery) {
      // Only show "No results found" if there was a SQL query executed
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*No results found.*'
        }
      });
    }

    if (executionSteps.length > 0) {
      if (blocks.length > 0) {
        blocks.push({
          type: 'divider'
        });
      }
      const stepsText = executionSteps
        .map((step, idx) => `${idx + 1}. *${step.title}*${step.detail ? `\n   ${step.detail}` : ''}`)
        .join('\n');
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: truncateSlackMrkdwn(`*How this answer was produced*\n${stepsText}`)
        }
      });
    }

    // Divider between CSV Data and SQL Query Section
    if (blocks.length > 0 && (sqlQuery || (queryResults && Array.isArray(queryResults) && queryResults.length > 0))) {
      blocks.push({
        type: 'divider'
      });
    }

    // 3. SQL Query Section
    if (sqlQuery) {
      // SQL Query Section Header
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*SQL Query Section*'
        }
      });

      // SQL Query Section Buttons
      // Using 'primary' style for primary action, default for secondary
      const sqlButtons: any[] = [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '👀 Show SQL'
          },
          action_id: `show_sql_${responseId}`,
          value: responseId,
          style: 'primary' // Blue button for primary action
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '👨‍🏫 Explain SQL'
          },
          action_id: `explain_sql_${responseId}`,
          value: responseId
          // Default gray style for secondary action
        }
      ];
      
      blocks.push({
        type: 'actions',
        elements: sqlButtons
      });

      // SQL Query Box (hidden by default)
      // Will be shown/hidden via button interactions
    }

    // Divider between SQL Query and Chart Section
    if (blocks.length > 0 && queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
      blocks.push({
        type: 'divider'
      });
    }

    // 4. Chart Section
    if (queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
      // Chart Section Header
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Chart Section*'
        }
      });

      // Chart Section Buttons - First row: Plot/Hide Chart
      // Using 'primary' style for the main plot action
      blocks.push({
        type: 'actions',
        elements: [{
          type: 'button',
          text: {
            type: 'plain_text',
            text: '👀 Plot Chart'
          },
          action_id: `plot_chart_${responseId}`,
          value: responseId,
          style: 'primary' // Blue button for primary action
        }]
      });

      // Chart Section Buttons - Second row: Chart types
      const chartTypeButtons = [
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📈 Line Chart'
          },
          action_id: `chart_type_line_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📊 Bar Chart'
          },
          action_id: `chart_type_bar_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📊 Grouped Bar Chart'
          },
          action_id: `chart_type_grouped_bar_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📊 Histogram Chart'
          },
          action_id: `chart_type_histogram_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🥧 Pie Chart'
          },
          action_id: `chart_type_pie_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '⚪ Scatter Chart'
          },
          action_id: `chart_type_scatter_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📦 Box Plot Chart'
          },
          action_id: `chart_type_box_plot_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '🫧 Bubble Chart'
          },
          action_id: `chart_type_bubble_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📊 KPI Chart'
          },
          action_id: `chart_type_kpi_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📊 KPI Plus Chart'
          },
          action_id: `chart_type_kpi_plus_${responseId}`,
          value: responseId
        },
        {
          type: 'button',
          text: {
            type: 'plain_text',
            text: '📈 Area Chart'
          },
          action_id: `chart_type_area_${responseId}`,
          value: responseId
        }
      ];

      // Slack allows max 5 elements per actions block — split chart buttons into rows
      for (let i = 0; i < chartTypeButtons.length; i += 5) {
        blocks.push({
          type: 'actions',
          elements: chartTypeButtons.slice(i, i + 5)
        });
      }

      // Chart Box (hidden by default)
      // Will be shown/hidden via button interactions
      // Charts will be displayed inline using image blocks when generated
    }

    if (followUpQuestions.length > 0) {
      if (blocks.length > 0) {
        blocks.push({
          type: 'divider'
        });
      }
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*Suggested follow-up questions*'
        }
      });
      const followUpButtons = followUpQuestions.map((q, idx) => ({
        question: q,
        button: {
          type: 'button',
          text: {
            type: 'plain_text',
            text: `Ask this follow-up ${idx + 1}`
          },
          action_id: `follow_up_${idx}_${responseId}`,
          value: responseId
        }
      }));
      for (let i = 0; i < followUpButtons.length; i += 1) {
        blocks.push({
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `${i + 1}. ${truncateSlackMrkdwn(followUpButtons[i].question)}`
          }
        });
        blocks.push({
          type: 'actions',
          elements: [followUpButtons[i].button]
        });
      }
    }

    // Slack allows at most 50 blocks per message
    const finalBlocks = blocks.slice(0, 50);
    const fallbackText = (interpretation || 'Query Results').slice(0, 12000);

    return {
      text: fallbackText,
      blocks: finalBlocks
    };
  } catch (error: any) {
    console.error('❌ Error processing Slack event:', error);
    console.error('❌ Error stack:', error.stack);
    return {
      text: `❌ Error processing your query: ${error.message || 'Unknown error'}`
    };
  }
}

/**
 * Get Slack config for a user
 */
export async function getSlackConfigForUser(userId: number) {
  return await thirdPartyService.getThirdPartyConfig(userId, 'slack');
}

