import { visualizationService } from '../visualization';
import { slackFileUploadService } from './slack_file_upload';
import { getSlackConfigForUser } from './slack-handler';
import {
  truncateSlackMrkdwn,
  slackMrkdwnWouldTruncate,
  splitSlackMrkdwnIntoChunks,
  SLACK_MRKDWN_SECTION_MAX,
} from './slack-block-utils';
import { SlackBlock } from '../../types/commands';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

interface InteractionResult {
    blocks: SlackBlock[];
    updateMessage?: boolean;
    filePath?: string;
    fileTitle?: string;
    fileComment?: string;
}

/**
 * Get cached response from global slackResponseCache
 */
function getCachedResponse(responseId: string): any {
    const responseCache = (global as any).slackResponseCache;
    if (!responseCache) {
        console.error('❌ slackResponseCache not initialized');
        return null;
    }
    const cached = responseCache.get(responseId);
    if (!cached) {
        console.error(`❌ No cached response found for responseId: ${responseId}`);
        console.log('Available cache keys:', Array.from(responseCache.keys()));
    }
    return cached;
}

/**
 * Update cached response in global slackResponseCache
 */
function updateCachedResponse(responseId: string, updates: any): void {
    const responseCache = (global as any).slackResponseCache;
    if (!responseCache) {
        return;
    }
    const existing = responseCache.get(responseId);
    if (existing) {
        responseCache.set(responseId, { ...existing, ...updates });
    }
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

async function handleDeleteUploadedFile(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions?.[0]?.value as string;
        if (!responseId) {
            return {
                blocks: [{
                    type: "section",
                    text: { type: "mrkdwn", text: "❌ Missing file reference." }
                }]
            };
        }

        const cachedData = getCachedResponse(responseId);
        const targetUserId = cachedData?.userId as number | undefined;
        const fileId = cachedData?.fileId as string | undefined;

        if (!targetUserId || !fileId) {
            return {
                blocks: [{
                    type: "section",
                    text: { type: "mrkdwn", text: "❌ File reference expired or missing. Please upload again if needed." }
                }]
            };
        }

        const slackConfig = await getSlackConfigForUser(targetUserId);
        const token = slackConfig?.config?.apiToken;
        if (!token) {
            return {
                blocks: [{
                    type: "section",
                    text: { type: "mrkdwn", text: "❌ Slack token not found. Please reconnect Slack in settings." }
                }]
            };
        }

        const deleteResp = await axios.post(
            'https://slack.com/api/files.delete',
            { file: fileId },
            {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (!deleteResp.data?.ok) {
            const err = deleteResp.data?.error || 'unknown_error';
            return {
                blocks: [{
                    type: "section",
                    text: { type: "mrkdwn", text: `❌ Could not delete file (${err}).` }
                }]
            };
        }

        // Clear stale cache entry after successful deletion.
        const responseCache = (global as any).slackResponseCache;
        if (responseCache && typeof responseCache.delete === 'function') {
            responseCache.delete(responseId);
        }

        return {
            blocks: [
                {
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "✅ File deleted from Slack."
                    }
                }
            ],
            updateMessage: true
        };
    } catch (error: any) {
        const msg = error?.response?.data?.error || error?.message || 'Unknown error';
        return {
            blocks: [{
                type: "section",
                text: { type: "mrkdwn", text: `❌ Error deleting file: ${msg}` }
            }]
        };
    }
}

/**
 * Rebuild message blocks to match frontend layout
 */
function rebuildMessageBlocksForSlack(cachedData: any, responseId: string): SlackBlock[] {
    const blocks: SlackBlock[] = [];
    const {
      interpretation,
      sqlQuery,
      queryResults,
      executionSteps,
      followUpQuestions,
      sqlVisible,
      csvVisible,
      csvExpanded,
      chartVisible,
      chartImagePath,
      sqlExplanation,
      sqlExplanationExpanded,
    } = cachedData;
    
    // Helper function to convert a value to a CSV-safe string with float formatting
    const valueToCSVString = (value: any): string => {
        if (value === null || value === undefined) return '';
        if (value instanceof Date) {
            return value.toISOString().split('T')[0];
        }
        // Format floats to 2 decimal places
        if (typeof value === 'number' && !Number.isInteger(value)) {
            return value.toFixed(2);
        }
        if (typeof value === 'object') {
            if (value.value && typeof value.value === 'string') {
                return value.value;
            }
            if (value.toString && value.toString !== Object.prototype.toString) {
                const str = value.toString();
                if (str !== '[object Object]') {
                    return str;
                }
            }
            if (value.date) return String(value.date);
            if (value.timestamp) return String(value.timestamp);
            if (value.time) return String(value.time);
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
    
    // 1. Response Section (always shown) — mrkdwn must be ≤3000 chars
    if (interpretation) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: truncateSlackMrkdwn(`*Response:*\n${interpretation}`)
            }
        });
    }

    // Divider between Response and CSV Data Section (never first block)
    if (blocks.length > 0 && queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
        blocks.push({
            type: 'divider'
        });
    }

    // 2. CSV Data Section
    if (queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*CSV Data Section*'
            }
        });

        // CSV Data Section Buttons - using 'primary' style for primary actions
        const dataButtons: any[] = [
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: csvVisible ? '🙈 Hide CSV' : '👀 Show CSV'
                },
                action_id: csvVisible ? `hide_csv_${responseId}` : `show_csv_${responseId}`,
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

        // CSV Data Box (shown if csvVisible is true)
        if (csvVisible) {
            const headers = Object.keys(queryResults[0]);
            const showAll = cachedData.csvExpanded || false;
            const displayResults = showAll ? queryResults : queryResults.slice(0, 5);
            
            // Format as table with grid lines
            const tableText = formatDataAsTable(headers, queryResults, showAll);
            
            let displayText = `*CSV Data:*\n\`\`\`\n${tableText}\n\`\`\`${!showAll && queryResults.length > 5 ? `\n_Showing first 5 of ${queryResults.length} rows_` : showAll ? `\n_Showing all ${queryResults.length} rows_` : ''}`;
            displayText = truncateSlackMrkdwn(displayText);

            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: displayText
                }
            });
            
            if (queryResults.length > 5) {
                blocks.push({
                    type: 'actions',
                    elements: [{
                        type: 'button',
                        text: {
                            type: 'plain_text',
                            text: showAll ? '🔽 Show Less' : '🔼 Show More'
                        },
                        action_id: showAll ? `show_less_data_${responseId}` : `show_more_data_${responseId}`,
                        value: responseId
                    }]
                });
            }
        }
    }

    // Divider between CSV Data and SQL Query Section
    if (blocks.length > 0 && (sqlQuery || (queryResults && Array.isArray(queryResults) && queryResults.length > 0))) {
        blocks.push({
            type: 'divider'
        });
    }

    if (Array.isArray(executionSteps) && executionSteps.length > 0) {
        if (blocks.length > 0) {
            blocks.push({
                type: 'divider'
            });
        }
        const stepsText = executionSteps
            .map((step: any, idx: number) => {
                const title = typeof step?.title === 'string' ? step.title.trim() : '';
                const detail = typeof step?.detail === 'string' ? step.detail.trim() : '';
                if (!title) return '';
                return `${idx + 1}. *${title}*${detail ? `\n   ${detail}` : ''}`;
            })
            .filter((line: string) => line.length > 0)
            .join('\n');
        if (stepsText) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: truncateSlackMrkdwn(`*How this answer was produced*\n${stepsText}`)
                }
            });
        }
    }

    // 3. SQL Query Section
    if (sqlQuery) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*SQL Query Section*'
            }
        });

        // SQL Query Section Buttons - using 'primary' style for primary action
        const sqlButtons: any[] = [
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: sqlVisible ? '🙈 Hide SQL' : '👀 Show SQL'
                },
                action_id: sqlVisible ? `hide_sql_${responseId}` : `show_sql_${responseId}`,
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

        // SQL Query Box (shown if sqlVisible is true) — long SQL must be truncated for Slack
        if (sqlVisible) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: truncateSlackMrkdwn(`*SQL Query:*\n\`\`\`\n${sqlQuery}\n\`\`\``)
                }
            });
        }

        // SQL Explanation (shown if sqlExplanation exists) — Slack max 3000 chars/section; "See all" expands to multiple sections
        if (sqlExplanation) {
            const fullExplanationBlock = `*SQL Explanation:*\n${sqlExplanation}`;
            const expanded = !!sqlExplanationExpanded;
            const needsTruncate = slackMrkdwnWouldTruncate(fullExplanationBlock, SLACK_MRKDWN_SECTION_MAX);

            if (!needsTruncate || expanded) {
                const chunks = splitSlackMrkdwnIntoChunks(fullExplanationBlock, SLACK_MRKDWN_SECTION_MAX);
                for (const chunk of chunks) {
                    blocks.push({
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: chunk,
                        },
                    });
                }
                if (needsTruncate && expanded) {
                    blocks.push({
                        type: 'actions',
                        elements: [
                            {
                                type: 'button',
                                text: {
                                    type: 'plain_text',
                                    text: 'Show less',
                                },
                                action_id: `sql_explanation_show_less_${responseId}`,
                                value: responseId,
                            },
                        ],
                    });
                }
            } else {
                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: truncateSlackMrkdwn(fullExplanationBlock),
                    },
                });
                blocks.push({
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: 'See all',
                            },
                            action_id: `sql_explanation_see_all_${responseId}`,
                            value: responseId,
                            style: 'primary',
                        },
                    ],
                });
            }
        }
    }

    // Divider between SQL Query and Chart Section
    if (blocks.length > 0 && queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
        if (sqlQuery || (!sqlQuery && queryResults && Array.isArray(queryResults) && queryResults.length > 0)) {
            blocks.push({
                type: 'divider'
            });
        }
    }

    // 4. Chart Section
    if (queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
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
                    text: chartVisible ? '🙈 Hide Chart' : '👀 Plot Chart'
                },
                action_id: chartVisible ? `hide_chart_${responseId}` : `plot_chart_${responseId}`,
                value: responseId,
                style: 'primary' // Blue button for primary action
            }]
        });

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

        // Chart Box - Chart is uploaded to Slack separately as a file attachment
        // We don't display it inline in blocks to avoid duplicate images
        // The file upload (with channel_id) automatically creates a separate attachment
        if (chartVisible && chartImagePath) {
            // Just show a message that chart has been generated
            // The actual chart appears as a separate file attachment from the upload
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '*Chart:*\n✅ Chart has been generated and uploaded to Slack.'
                }
            });
        }
    }

    if (Array.isArray(followUpQuestions) && followUpQuestions.length > 0) {
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
        const followUpButtons = followUpQuestions
            .map((q: any, idx: number) => {
                const question = String(q).trim();
                if (!question) return null;
                return {
                    question,
                    button: {
                        type: 'button',
                        text: {
                            type: 'plain_text',
                            text: `Ask this follow-up ${idx + 1}`
                        },
                        action_id: `follow_up_${idx}_${responseId}`,
                        value: responseId
                    }
                };
            })
            .filter((btn): btn is any => Boolean(btn));
        for (const button of followUpButtons) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: truncateSlackMrkdwn(button.question)
                }
            });
            blocks.push({
                type: 'actions',
                elements: [button.button]
            });
        }
    }

    return blocks.slice(0, 50);
}

/**
 * Handle Show More/Less Data button click (toggle expand/collapse)
 */
async function handleShowMoreData(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        const actionId = payload.actions[0].action_id;
        const isShowLess = actionId.startsWith('show_less_data_');
        
        console.log(`${isShowLess ? 'Show Less' : 'Show More'} Data requested for response ID:`, responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found. The response may have expired (cache TTL: 1 hour)."
                    }
                }]
            };
        }

        if (!Array.isArray(cachedData.queryResults) || cachedData.queryResults.length === 0) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ No data available."
                    }
                }]
            };
        }

        // Toggle expanded state
        const newExpanded = !isShowLess;
        updateCachedResponse(responseId, { csvExpanded: newExpanded });
        
        // Rebuild message blocks with new state
        const updatedBlocks = rebuildMessageBlocksForSlack({ ...cachedData, csvExpanded: newExpanded }, responseId);
        
        return {
            blocks: updatedBlocks,
            updateMessage: true
        };
    } catch (error) {
        console.error('Error in handleShowMoreData:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error retrieving data: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Extract Response section from original message blocks
 */
function extractResponseSection(originalBlocks: any[]): SlackBlock | null {
    if (!originalBlocks || !Array.isArray(originalBlocks)) return null;
    const responseBlock = originalBlocks.find(block => 
        block.type === 'section' && 
        block.text && 
        block.text.text && 
        block.text.text.includes('*Response:*')
    );
    return responseBlock || null;
}

/**
 * Rebuild message blocks with SQL and Chart visibility state
 */
function rebuildMessageBlocks(
    cachedQuery: any,
    showSQL: boolean,
    showChart: boolean,
    originalBlocks?: any[]
): SlackBlock[] {
    const blocks: SlackBlock[] = [];
    
    // Results section (always shown) - in CSV format
    const dataToShow = Array.isArray(cachedQuery.queryResults) 
        ? cachedQuery.queryResults.slice(0, 5) 
        : cachedQuery.queryResults;
    
    // Convert to CSV format for display
    const csvContent = convertDataToCSVForDisplay(dataToShow);
    
    blocks.push({
        type: "section",
        text: {
            type: "mrkdwn",
            text: truncateSlackMrkdwn(
                `*Results:*\n\`\`\`${csvContent}\`\`\`${Array.isArray(cachedQuery.queryResults) && cachedQuery.queryResults.length > 5 ? `\n*... and ${cachedQuery.queryResults.length - 5} more rows*` : ''}`
            )
        }
    });
    
    // Show More Data button if needed
    if (Array.isArray(cachedQuery.queryResults) && cachedQuery.queryResults.length > 5) {
        blocks.push({
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "Show More Data"
                    },
                    action_id: `show_more_data_${cachedQuery.id}`,
                    value: cachedQuery.id
                }
            ]
        });
    }
    
    // SQL Query section (conditionally shown)
    if (showSQL) {
        blocks.push({
            type: "section",
            text: {
                type: "mrkdwn",
                text: truncateSlackMrkdwn(`*SQL Query Executed:*\n\`\`\`${cachedQuery.sqlQuery}\`\`\``)
            }
        });
    }
    
    // Chart section (conditionally shown - will be added by caller if needed)
    // We don't add it here because it needs to be inserted at the right position
    
    // Response section (preserve from original message if available, but exclude chart sections)
    if (originalBlocks) {
        // Filter out chart sections from original blocks before extracting response
        const filteredBlocks = showChart ? originalBlocks : filterOutChartSections(originalBlocks);
        const responseBlock = extractResponseSection(filteredBlocks);
        if (responseBlock) {
            blocks.push(responseBlock);
        }
    }
    
    // Action buttons with toggle states
    blocks.push({
        type: "actions",
        elements: [
            {
                type: "button",
                text: {
                    type: "plain_text",
                    text: showSQL ? "Hide SQL Query" : "Show SQL Query"
                },
                action_id: showSQL ? `hide_sql_${cachedQuery.id}` : `show_sql_${cachedQuery.id}`,
                value: cachedQuery.id
            },
            {
                type: "button",
                text: {
                    type: "plain_text",
                    text: showChart ? "Hide Chart" : "Show Chart"
                },
                action_id: showChart ? `hide_chart_${cachedQuery.id}` : `show_chart_${cachedQuery.id}`,
                value: cachedQuery.id
            },
            {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "Download CSV"
                },
                action_id: `download_csv_${cachedQuery.id}`,
                value: cachedQuery.id
            },
            {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "Download JSON"
                },
                action_id: `download_json_${cachedQuery.id}`,
                value: cachedQuery.id
            },
            {
                type: "button",
                text: {
                    type: "plain_text",
                    text: "Download PNG"
                },
                action_id: `download_png_${cachedQuery.id}`,
                value: cachedQuery.id
            }
        ]
    });
    
    // Chart type buttons (if visualization is available)
    if (visualizationService.isDataVisualizable(cachedQuery.queryResults)) {
        blocks.push({
            type: "actions",
            elements: [
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "📊 Bar"
                    },
                    action_id: `chart_type_bar_${cachedQuery.id}`,
                    value: cachedQuery.id
                },
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "🥧 Pie"
                    },
                    action_id: `chart_type_pie_${cachedQuery.id}`,
                    value: cachedQuery.id
                },
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "📈 Line"
                    },
                    action_id: `chart_type_line_${cachedQuery.id}`,
                    value: cachedQuery.id
                },
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "🔲 Scatter"
                    },
                    action_id: `chart_type_scatter_${cachedQuery.id}`,
                    value: cachedQuery.id
                },
                {
                    type: "button",
                    text: {
                        type: "plain_text",
                        text: "📉 Histogram"
                    },
                    action_id: `chart_type_histogram_${cachedQuery.id}`,
                    value: cachedQuery.id
                }
            ]
        });
    }
    
    return blocks;
}

/**
 * Check if SQL is visible in message blocks
 */
function isSQLVisible(blocks: any[]): boolean {
    if (!blocks || !Array.isArray(blocks)) return false;
    return blocks.some(block => 
        block.type === 'section' && 
        block.text && 
        block.text.text && 
        block.text.text.includes('SQL Query Executed')
    );
}

/**
 * Check if Chart is visible in message blocks
 */
function isChartVisible(blocks: any[]): boolean {
    if (!blocks || !Array.isArray(blocks)) return false;
    return blocks.some(block => 
        block.type === 'section' && 
        block.text && 
        block.text.text && 
        (block.text.text.includes('Chart Generated') || 
         block.text.text.includes('Visualization') ||
         block.text.text.includes('✅ Chart'))
    );
}

/**
 * Filter out chart sections from blocks
 */
function filterOutChartSections(blocks: any[]): any[] {
    if (!blocks || !Array.isArray(blocks)) return blocks;
    return blocks.filter(block => {
        if (block.type === 'section' && block.text && block.text.text) {
            const text = block.text.text;
            return !(text.includes('Chart Generated') || 
                     text.includes('Visualization') ||
                     text.includes('✅ Chart'));
        }
        return true;
    });
}

/**
 * Handle Show/Hide SQL Query button click
 */
async function handleShowSQL(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        const actionId = payload.actions[0].action_id;
        const isHide = actionId.startsWith('hide_sql_');
        
        console.log(`${isHide ? 'Hide' : 'Show'} SQL requested for response ID:`, responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found. The response may have expired (cache TTL: 1 hour)."
                    }
                }]
            };
        }

        // Toggle SQL visibility
        const newSQLVisible = isHide ? false : !cachedData.sqlVisible;
        updateCachedResponse(responseId, { sqlVisible: newSQLVisible });
        
        // Rebuild message blocks with new state
        const updatedBlocks = rebuildMessageBlocksForSlack({ ...cachedData, sqlVisible: newSQLVisible }, responseId);
        
        return {
            blocks: updatedBlocks,
            updateMessage: true
        };
    } catch (error) {
        console.error('Error in handleShowSQL:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error retrieving SQL query: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Expand SQL explanation to full text (multiple Slack sections)
 */
async function handleSqlExplanationSeeAll(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        const cachedData = getCachedResponse(responseId);
        if (!cachedData?.sqlExplanation) {
            return {
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '❌ SQL explanation not found. It may have expired.',
                        },
                    },
                ],
            };
        }
        updateCachedResponse(responseId, { sqlExplanationExpanded: true });
        const updatedBlocks = rebuildMessageBlocksForSlack(
            { ...cachedData, sqlExplanationExpanded: true },
            responseId
        );
        return { blocks: updatedBlocks, updateMessage: true };
    } catch (error) {
        console.error('Error in handleSqlExplanationSeeAll:', error);
        return {
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `❌ ${error instanceof Error ? error.message : 'Unknown error'}`,
                    },
                },
            ],
        };
    }
}

/**
 * Collapse SQL explanation back to truncated preview
 */
async function handleSqlExplanationShowLess(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        const cachedData = getCachedResponse(responseId);
        if (!cachedData) {
            return {
                blocks: [
                    {
                        type: 'section',
                        text: {
                            type: 'mrkdwn',
                            text: '❌ Response data not found.',
                        },
                    },
                ],
            };
        }
        updateCachedResponse(responseId, { sqlExplanationExpanded: false });
        const updatedBlocks = rebuildMessageBlocksForSlack(
            { ...cachedData, sqlExplanationExpanded: false },
            responseId
        );
        return { blocks: updatedBlocks, updateMessage: true };
    } catch (error) {
        console.error('Error in handleSqlExplanationShowLess:', error);
        return {
            blocks: [
                {
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `❌ ${error instanceof Error ? error.message : 'Unknown error'}`,
                    },
                },
            ],
        };
    }
}

/**
 * Handle Explain SQL button click
 */
async function handleExplainSQL(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        console.log('Explain SQL requested for response ID:', responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found. The response may have expired (cache TTL: 1 hour)."
                    }
                }]
            };
        }
        
        if (!cachedData.sqlQuery) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ SQL query not found in cached data."
                    }
                }]
            };
        }

        if (!cachedData.apiBaseUrl) {
            console.error('❌ apiBaseUrl not found in cached data');
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ API base URL not configured. Please try asking your question again."
                    }
                }]
            };
        }

        // Call explain-sql API endpoint
        console.log(`Calling explain-sql API at: ${cachedData.apiBaseUrl}/api/explain-sql`);
        const explainResponse = await axios.post(`${cachedData.apiBaseUrl}/api/explain-sql`, {
            sqlQuery: cachedData.sqlQuery,
            userId: cachedData.userId
        });

        const explanation = explainResponse.data.explanation || explainResponse.data.text || 'No explanation available.';

        // Store explanation in cache and rebuild message blocks to display it inline
        updateCachedResponse(responseId, {
            sqlExplanation: explanation,
            sqlExplanationExpanded: false,
        });
        const updatedBlocks = rebuildMessageBlocksForSlack(
            { ...cachedData, sqlExplanation: explanation, sqlExplanationExpanded: false },
            responseId
        );

        return {
            blocks: updatedBlocks,
            updateMessage: true
        };
    } catch (error: any) {
        console.error('Error in handleExplainSQL:', error);
        const errorMessage = error?.response?.data?.error || error?.message || 'Unknown error';
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error explaining SQL: ${errorMessage}`
                }
            }]
        };
    }
}

/**
 * Handle Edit SQL button click
 */
async function handleEditSQL(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        console.log('Edit SQL requested for response ID:', responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData || !cachedData.sqlQuery) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ SQL query not found."
                    }
                }]
            };
        }

        // For Slack, we can't directly edit SQL, so we'll show the SQL and suggest the user to ask for modifications
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `*Current SQL Query:*\n\`\`\`\n${cachedData.sqlQuery}\n\`\`\`\n\n*Note:* To edit this SQL query, please send a new message describing the changes you'd like to make.`
                }
            }]
        };
    } catch (error) {
        console.error('Error in handleEditSQL:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Handle Run SQL button click
 */
async function handleRunSQL(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        console.log('Run SQL requested for response ID:', responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found. The response may have expired (cache TTL: 1 hour)."
                    }
                }]
            };
        }
        
        if (!cachedData.sqlQuery) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ SQL query not found in cached data."
                    }
                }]
            };
        }

        if (!cachedData.apiBaseUrl) {
            console.error('❌ apiBaseUrl not found in cached data');
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ API base URL not configured. Please try asking your question again."
                    }
                }]
            };
        }

        // Call query/execute API endpoint
        console.log(`Calling query/execute API at: ${cachedData.apiBaseUrl}/api/query/execute`);
        const executeResponse = await axios.post(`${cachedData.apiBaseUrl}/api/query/execute`, {
            sqlQuery: cachedData.sqlQuery,
            userId: cachedData.userId
        });

        const { queryResults, error } = executeResponse.data;

        if (error) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: `❌ Error executing SQL: ${error}`
                    }
                }]
            };
        }

        // Update cache with new results
        updateCachedResponse(responseId, { queryResults });

        // Rebuild message blocks to show updated data
        const updatedBlocks = rebuildMessageBlocksForSlack({ ...cachedData, queryResults }, responseId);

        return {
            blocks: updatedBlocks,
            updateMessage: true
        };
    } catch (error: any) {
        console.error('Error in handleRunSQL:', error);
        const errorMessage = error?.response?.data?.error || error?.message || 'Unknown error';
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error executing SQL: ${errorMessage}`
                }
            }]
        };
    }
}

/**
 * Handle Show/Hide CSV button click
 */
async function handleShowCSV(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        const actionId = payload.actions[0].action_id;
        const isHide = actionId.startsWith('hide_csv_');
        
        console.log(`${isHide ? 'Hide' : 'Show'} CSV requested for response ID:`, responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found."
                    }
                }]
            };
        }

        // Toggle CSV visibility
        const newCSVVisible = isHide ? false : !cachedData.csvVisible;
        updateCachedResponse(responseId, { csvVisible: newCSVVisible });
        
        // Rebuild message blocks with new state
        const updatedBlocks = rebuildMessageBlocksForSlack({ ...cachedData, csvVisible: newCSVVisible }, responseId);
        
        return {
            blocks: updatedBlocks,
            updateMessage: true
        };
    } catch (error) {
        console.error('Error in handleShowCSV:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Handle Plot/Hide Chart button click
 */
async function handlePlotChart(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        const actionId = payload.actions[0].action_id;
        const isHide = actionId.startsWith('hide_chart_');
        
        console.log(`${isHide ? 'Hide' : 'Plot'} Chart requested for response ID:`, responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found."
                    }
                }]
            };
        }

        if (!Array.isArray(cachedData.queryResults) || cachedData.queryResults.length === 0) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ No data available for visualization."
                    }
                }]
            };
        }

        if (!visualizationService.isDataVisualizable(cachedData.queryResults)) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Data is not suitable for visualization."
                    }
                }]
            };
        }

        // Toggle chart visibility
        const newChartVisible = isHide ? false : !cachedData.chartVisible;
        
        // If hiding, just rebuild blocks without generating chart
        if (isHide || !newChartVisible) {
            updateCachedResponse(responseId, { chartVisible: false, chartImagePath: null });
            const updatedBlocks = rebuildMessageBlocksForSlack({ ...cachedData, chartVisible: false }, responseId);
            return {
                blocks: updatedBlocks,
                updateMessage: true
            };
        }
        
        // If showing, generate chart and rebuild blocks
        console.log('Generating chart for response ID:', responseId);
        
        // Generate visualization
        const vizResult = await visualizationService.generateLLMVisualization({
            data: cachedData.queryResults,
            question: cachedData.question,
            chartType: undefined, // Use default
            userId: cachedData.userId
        });

        if (vizResult.success && vizResult.imagePath) {
            // Upload chart to Slack for permanent storage (like Kira-slackbot)
            // This ensures charts persist forever, even after server restarts
            let slackFileUrl: string | undefined = undefined;
            try {
                // Get Slack config for the user
                const slackConfig = await getSlackConfigForUser(cachedData.userId);
                const channelId = payload.channel?.id;
                
                if (slackConfig?.config?.apiToken && channelId) {
                    // Upload chart to Slack using files.uploadV2 WITH channel_id
                    // This stores it permanently on Slack's servers
                    const uploadResult = await slackFileUploadService.uploadFile(
                        channelId,
                        vizResult.imagePath,
                        slackConfig.config.apiToken,
                        'Chart Visualization',
                        '📊 Chart visualization generated'
                    );
                    
                    if (uploadResult.success) {
                        // When uploading with channel_id, file appears automatically as attachment
                        // fileUrl might be empty, but that's okay - the file is still uploaded
                        slackFileUrl = uploadResult.fileUrl;
                        if (slackFileUrl) {
                            console.log(`✅ Chart uploaded to Slack successfully: ${slackFileUrl}`);
                        } else {
                            console.log(`✅ Chart uploaded to Slack successfully (appears as attachment)`);
                        }
                    } else {
                        console.warn('⚠️ Chart upload to Slack failed:', uploadResult.error);
                    }
                } else {
                    console.warn('⚠️ Slack config or channel ID not available for chart upload');
                }
            } catch (uploadError: any) {
                console.error('❌ Error uploading chart to Slack:', uploadError.message);
                // Continue with inline display even if upload fails
            }
            
            // Store chart image path and Slack file URL in cache
            // Use Slack file URL if available, otherwise use server URL
            const chartImageUrl = slackFileUrl || vizResult.imagePath;
            updateCachedResponse(responseId, { 
                chartVisible: true, 
                chartImagePath: vizResult.imagePath,
                chartSlackUrl: slackFileUrl
            });
            const updatedBlocks = rebuildMessageBlocksForSlack({ 
                ...cachedData, 
                chartVisible: true, 
                chartImagePath: chartImageUrl
            }, responseId);
            
            return {
                blocks: updatedBlocks,
                updateMessage: true
            };
        }

        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Failed to generate chart: ${vizResult.error || 'Unknown error'}`
                }
            }]
        };
    } catch (error) {
        console.error('Error in handlePlotChart:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error generating chart: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Handle Download CSV button click
 */
async function handleDownloadCSV(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        console.log('Download CSV requested for response ID:', responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData || !Array.isArray(cachedData.queryResults) || cachedData.queryResults.length === 0) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found or no data available."
                    }
                }]
            };
        }

        // Convert to CSV
        const csvContent = convertToCSV(cachedData.queryResults);
        
        // Create temporary file
        const tempDir = path.join(os.tmpdir(), 'bigquery_downloads');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const filename = `query_results_${uuidv4().substring(0, 8)}.csv`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, csvContent);

        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "✅ CSV file ready for download!"
                }
            }],
            filePath: filePath,
            fileTitle: 'Query Results (CSV)',
            fileComment: '📄 CSV file for download'
        };
    } catch (error) {
        console.error('Error in handleDownloadCSV:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error generating CSV: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Handle Download JSON button click
 */
async function handleDownloadJSON(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        console.log('Download JSON requested for response ID:', responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData || !Array.isArray(cachedData.queryResults) || cachedData.queryResults.length === 0) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found or no data available."
                    }
                }]
            };
        }

        // Create temporary file
        const tempDir = path.join(os.tmpdir(), 'bigquery_downloads');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        
        const filename = `query_results_${uuidv4().substring(0, 8)}.json`;
        const filePath = path.join(tempDir, filename);
        fs.writeFileSync(filePath, JSON.stringify(cachedData.queryResults, null, 2));

        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: "✅ JSON file ready for download!"
                }
            }],
            filePath: filePath,
            fileTitle: 'Query Results (JSON)',
            fileComment: '📄 JSON file for download'
        };
    } catch (error) {
        console.error('Error in handleDownloadJSON:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error generating JSON: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Handle Download PNG button click
 */
async function handleDownloadPNG(payload: any): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        console.log('Download PNG requested for response ID:', responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData || !Array.isArray(cachedData.queryResults) || cachedData.queryResults.length === 0) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found or no data available."
                    }
                }]
            };
        }

        if (!visualizationService.isDataVisualizable(cachedData.queryResults)) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Data is not suitable for visualization."
                    }
                }]
            };
        }

        // Generate visualization
        const vizResult = await visualizationService.generateLLMVisualization({
            data: cachedData.queryResults,
            question: cachedData.question,
            chartType: undefined,
            userId: cachedData.userId
        });

        if (vizResult.success && vizResult.imagePath) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "✅ PNG chart ready for download!"
                    }
                }],
                filePath: vizResult.imagePath,
                fileTitle: 'Chart Visualization (PNG)',
                fileComment: '📊 PNG chart image for download'
            };
        }

        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Failed to generate PNG: ${vizResult.error || 'Unknown error'}`
                }
            }]
        };
    } catch (error) {
        console.error('Error in handleDownloadPNG:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error generating PNG: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Handle chart type selection buttons
 */
async function handleChartType(payload: any, chartType: string): Promise<InteractionResult> {
    try {
        const responseId = payload.actions[0].value;
        console.log(`Chart type ${chartType} requested for response ID:`, responseId);
        
        const cachedData = getCachedResponse(responseId);
        
        if (!cachedData || !Array.isArray(cachedData.queryResults) || cachedData.queryResults.length === 0) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Response data not found or no data available."
                    }
                }]
            };
        }

        if (!visualizationService.isDataVisualizable(cachedData.queryResults)) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Data is not suitable for visualization."
                    }
                }]
            };
        }

        // Generate visualization with specific chart type
        const vizResult = await visualizationService.generateLLMVisualization({
            data: cachedData.queryResults,
            question: cachedData.question,
            chartType: chartType === 'custom' ? undefined : chartType, // For custom, let LLM decide
            userId: cachedData.userId
        });

        if (vizResult.success && vizResult.imagePath) {
            // Upload chart to Slack for permanent storage (like Kira-slackbot)
            // This ensures charts persist forever, even after server restarts
            let slackFileUrl: string | undefined = undefined;
            try {
                // Get Slack config for the user
                const slackConfig = await getSlackConfigForUser(cachedData.userId);
                const channelId = payload.channel?.id;
                
                if (slackConfig?.config?.apiToken && channelId) {
                    // Upload chart to Slack using files.uploadV2 WITH channel_id
                    // This stores it permanently on Slack's servers
                    const uploadResult = await slackFileUploadService.uploadFile(
                        channelId,
                        vizResult.imagePath,
                        slackConfig.config.apiToken,
                        'Chart Visualization',
                        '📊 Chart visualization generated'
                    );
                    
                    if (uploadResult.success) {
                        // When uploading with channel_id, file appears automatically as attachment
                        // fileUrl might be empty, but that's okay - the file is still uploaded
                        slackFileUrl = uploadResult.fileUrl;
                        if (slackFileUrl) {
                            console.log(`✅ Chart uploaded to Slack successfully: ${slackFileUrl}`);
                        } else {
                            console.log(`✅ Chart uploaded to Slack successfully (appears as attachment)`);
                        }
                    } else {
                        console.warn('⚠️ Chart upload to Slack failed:', uploadResult.error);
                    }
                } else {
                    console.warn('⚠️ Slack config or channel ID not available for chart upload');
                }
            } catch (uploadError: any) {
                console.error('❌ Error uploading chart to Slack:', uploadError.message);
                // Continue with inline display even if upload fails
            }
            
            // Store chart image path and Slack file URL in cache
            // Use Slack file URL if available, otherwise use server URL
            const chartImageUrl = slackFileUrl || vizResult.imagePath;
            updateCachedResponse(responseId, { 
                chartVisible: true, 
                chartImagePath: vizResult.imagePath,
                chartSlackUrl: slackFileUrl
            });
            const updatedBlocks = rebuildMessageBlocksForSlack({ 
                ...cachedData, 
                chartVisible: true, 
                chartImagePath: chartImageUrl
            }, responseId);
            
            return {
                blocks: updatedBlocks,
                updateMessage: true
            };
        }

        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Failed to generate ${chartType} chart: ${vizResult.error || 'Unknown error'}`
                }
            }]
        };
    } catch (error) {
        console.error(`Error in handleChartType (${chartType}):`, error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error generating ${chartType} chart: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}

async function handleFollowUpQuestion(payload: any): Promise<InteractionResult> {
    try {
        const actionId = payload.actions[0].action_id as string;
        const responseId = payload.actions[0].value as string;
        const match = actionId.match(/^follow_up_(\d+)_/);
        const questionIndex = match ? Number.parseInt(match[1], 10) : Number.NaN;

        if (!Number.isFinite(questionIndex)) {
            return {
                blocks: [{
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '❌ Invalid follow-up action.'
                    }
                }]
            };
        }

        const cachedData = getCachedResponse(responseId);
        const followUps = Array.isArray(cachedData?.followUpQuestions) ? cachedData.followUpQuestions : [];
        const selectedQuestion = followUps[questionIndex];

        if (!selectedQuestion || !cachedData?.apiBaseUrl || !cachedData?.userId) {
            return {
                blocks: [{
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: '❌ Follow-up question is unavailable. Please ask your question again.'
                    }
                }]
            };
        }

        const channelId = payload?.channel?.id as string | undefined;
        const slackConfig = await getSlackConfigForUser(cachedData.userId);
        const slackApiToken = slackConfig?.config?.apiToken as string | undefined;

        if (channelId && slackApiToken) {
            await axios.post('https://slack.com/api/chat.postMessage', {
                channel: channelId,
                text: selectedQuestion,
                blocks: [{
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `*Follow-up question selected:*\n${selectedQuestion}`
                    }
                }]
            }, {
                headers: {
                    'Authorization': `Bearer ${slackApiToken}`,
                    'Content-Type': 'application/json'
                }
            });
        }

        let followUpThinkingTs: string | null = null;
        let followUpInterval: NodeJS.Timeout | null = null;
        if (channelId && slackApiToken) {
            const steps = [
                { percent: 12, label: 'Understanding your goal' },
                { percent: 30, label: 'Gathering context' },
                { percent: 50, label: 'Drafting and checking SQL' },
                { percent: 72, label: 'Running the query' },
                { percent: 88, label: 'Summarizing results' },
            ];
            const bar = (p: number) => {
                const total = 10;
                const filled = Math.max(0, Math.min(total, Math.round((p / 100) * total)));
                return `${'█'.repeat(filled)}${'░'.repeat(total - filled)}`;
            };
            const thinking = await axios.post('https://slack.com/api/chat.postMessage', {
                channel: channelId,
                text: '🤔 Thinking...',
                blocks: [{
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `🤔 *Kira is working on your follow-up*\n*Progress:* 12% \`${bar(12)}\`\n_Current step: Understanding your goal_`
                    }
                }]
            }, {
                headers: {
                    'Authorization': `Bearer ${slackApiToken}`,
                    'Content-Type': 'application/json'
                }
            });
            if (thinking.data?.ok && thinking.data?.ts) {
                followUpThinkingTs = thinking.data.ts as string;
                let i = 0;
                followUpInterval = setInterval(async () => {
                    if (!followUpThinkingTs) return;
                    i = Math.min(i + 1, steps.length - 1);
                    const s = steps[i];
                    try {
                        await axios.post('https://slack.com/api/chat.update', {
                            channel: channelId,
                            ts: followUpThinkingTs,
                            text: '🤔 Thinking...',
                            blocks: [{
                                type: 'section',
                                text: {
                                    type: 'mrkdwn',
                                    text: `🤔 *Kira is working on your follow-up*\n*Progress:* ${s.percent}% \`${bar(s.percent)}\`\n_Current step: ${s.label}_`
                                }
                            }]
                        }, {
                            headers: {
                                'Authorization': `Bearer ${slackApiToken}`,
                                'Content-Type': 'application/json'
                            }
                        });
                    } catch {
                        // no-op
                    }
                }, 1800);
            }
        }

        const chatResponse = await axios.post(`${cachedData.apiBaseUrl}/api/chat`, {
            question: selectedQuestion,
            userId: cachedData.userId,
            userName: 'User',
        }, {
            headers: {
                'Content-Type': 'application/json'
            }
        });

        const { interpretation, sqlQuery, queryResults, error } = chatResponse.data || {};
        if (error) {
            return {
                blocks: [{
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `❌ Error running follow-up query: ${error}`
                    }
                }]
            };
        }

        const newResponseId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const newCachedData = {
            interpretation: interpretation || '',
            sqlQuery,
            queryResults,
            executionSteps: normalizeSlackExecutionSteps(chatResponse.data?.executionSteps),
            followUpQuestions: normalizeSlackFollowUpQuestions(chatResponse.data?.followUpQuestions),
            userId: cachedData.userId,
            timestamp: Date.now(),
            sqlVisible: false,
            csvVisible: true,
            csvExpanded: false,
            chartVisible: false,
            chartGenerated: false,
            question: selectedQuestion,
            apiBaseUrl: cachedData.apiBaseUrl,
        };

        const responseCache = (global as any).slackResponseCache || new Map();
        (global as any).slackResponseCache = responseCache;
        responseCache.set(newResponseId, newCachedData);

        const blocks = rebuildMessageBlocksForSlack(newCachedData, newResponseId);

        if (followUpInterval) {
            clearInterval(followUpInterval);
            followUpInterval = null;
        }
        if (channelId && slackApiToken && followUpThinkingTs) {
            await axios.post('https://slack.com/api/chat.update', {
                channel: channelId,
                ts: followUpThinkingTs,
                text: interpretation || 'Query Results',
                blocks
            }, {
                headers: {
                    'Authorization': `Bearer ${slackApiToken}`,
                    'Content-Type': 'application/json'
                }
            });
            return { blocks: [], updateMessage: false };
        }

        return { blocks, updateMessage: false };
    } catch (error: any) {
        return {
            blocks: [{
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `❌ Error running follow-up query: ${error?.message || 'Unknown error'}`
                }
            }]
        };
    }
}

/**
 * Convert data array to CSV format for display (handles nested objects with 'value' property)
 */
function convertDataToCSVForDisplay(data: any): string {
    if (!data) {
        return '';
    }
    
    // Handle non-array data
    if (!Array.isArray(data)) {
        return String(data);
    }
    
    if (data.length === 0) {
        return '';
    }

    const headers = Object.keys(data[0]);
    const csvRows = [];

    // Add headers
    csvRows.push(headers.join(','));

    // Add data rows - use the same valueToCSVString helper for consistency
    for (const row of data) {
        const values = headers.map(header => {
            const value = row[header];
            const stringValue = valueToCSVString(value);
            
            // Escape commas and quotes
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        });
        csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
}

/**
 * Helper function to convert a value to a CSV-safe string
 */
function valueToCSVString(value: any): string {
    if (value === null || value === undefined) {
        return '';
    }
    
    // Handle Date objects
    if (value instanceof Date) {
        return value.toISOString().split('T')[0]; // Format as YYYY-MM-DD
    }
    
    // Handle objects (including date-like objects from BigQuery)
    if (typeof value === 'object') {
        // Check if it's a date-like object with common date properties
        if (value.value && typeof value.value === 'string') {
            // BigQuery date objects sometimes have a 'value' property
            return value.value;
        }
        if (value.toString && value.toString !== Object.prototype.toString) {
            // If object has custom toString, use it
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
    
    // For primitives, convert to string
    return String(value);
}

/**
 * Convert data array to CSV format (for file downloads)
 */
function convertToCSV(data: any[]): string {
    if (!data || data.length === 0) {
        return '';
    }

    const headers = Object.keys(data[0]);
    const csvRows = [];

    // Add headers
    csvRows.push(headers.join(','));

    // Add data rows
    for (const row of data) {
        const values = headers.map(header => {
            const value = row[header];
            const stringValue = valueToCSVString(value);
            
            // Escape commas and quotes
            if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        });
        csvRows.push(values.join(','));
    }

    return csvRows.join('\n');
}

/**
 * Register all BigQuery interaction handlers
 */
export function slackInteractionHandlers() {
    return {
        // Dynamic handlers for each query ID
        // We'll use a pattern matcher in the main handler
    };
}

/**
 * Handle BigQuery interactions based on action_id pattern
 */
export async function handleslackInteraction(payload: any): Promise<InteractionResult> {
    try {
        // Validate payload
        if (!payload || !payload.actions || !Array.isArray(payload.actions) || payload.actions.length === 0) {
            return {
                blocks: [{
                    type: "section",
                    text: {
                        type: "mrkdwn",
                        text: "❌ Invalid request: missing actions"
                    }
                }]
            };
        }

        const actionId = payload.actions[0].action_id;
        const actionValue = payload.actions[0].value;

        console.log('🔍 Handling BigQuery interaction:', { actionId, actionValue });
        console.log('🔍 Full payload.actions[0]:', JSON.stringify(payload.actions[0], null, 2));

        // Extract response ID and action type from action_id
        if (actionId.startsWith('show_more_data_') || actionId.startsWith('show_less_data_')) {
            console.log('✅ Matched show_more_data_ or show_less_data_');
            return await handleShowMoreData(payload);
        } else if (actionId.startsWith('delete_uploaded_file_')) {
            return await handleDeleteUploadedFile(payload);
        } else if (actionId.startsWith('show_sql_') || actionId.startsWith('hide_sql_')) {
            console.log('✅ Matched show_sql_ or hide_sql_');
            return await handleShowSQL(payload);
        } else if (actionId.startsWith('sql_explanation_see_all_')) {
            return await handleSqlExplanationSeeAll(payload);
        } else if (actionId.startsWith('sql_explanation_show_less_')) {
            return await handleSqlExplanationShowLess(payload);
        } else if (actionId.startsWith('explain_sql_')) {
            console.log('✅ Matched explain_sql_');
            return await handleExplainSQL(payload);
        } else if (actionId.startsWith('edit_sql_')) {
            console.log('✅ Matched edit_sql_');
            return await handleEditSQL(payload);
        } else if (actionId.startsWith('run_sql_')) {
            console.log('✅ Matched run_sql_');
            return await handleRunSQL(payload);
        } else if (actionId.startsWith('show_csv_') || actionId.startsWith('hide_csv_')) {
            return await handleShowCSV(payload);
        } else if (actionId.startsWith('plot_chart_') || actionId.startsWith('hide_chart_')) {
            return await handlePlotChart(payload);
        } else if (actionId.startsWith('download_csv_')) {
            return await handleDownloadCSV(payload);
        } else if (actionId.startsWith('download_json_')) {
            return await handleDownloadJSON(payload);
        } else if (actionId.startsWith('download_png_')) {
            return await handleDownloadPNG(payload);
        } else if (actionId.startsWith('chart_type_line_')) {
            return await handleChartType(payload, 'line');
        } else if (actionId.startsWith('chart_type_bar_')) {
            return await handleChartType(payload, 'bar');
        } else if (actionId.startsWith('chart_type_grouped_bar_')) {
            return await handleChartType(payload, 'grouped bar');
        } else if (actionId.startsWith('chart_type_histogram_')) {
            return await handleChartType(payload, 'histogram');
        } else if (actionId.startsWith('chart_type_pie_')) {
            return await handleChartType(payload, 'pie');
        } else if (actionId.startsWith('chart_type_scatter_')) {
            return await handleChartType(payload, 'scatter');
        } else if (actionId.startsWith('chart_type_box_plot_')) {
            return await handleChartType(payload, 'box plot');
        } else if (actionId.startsWith('chart_type_bubble_')) {
            return await handleChartType(payload, 'bubble');
        } else if (actionId.startsWith('chart_type_kpi_plus_')) {
            return await handleChartType(payload, 'kpi plus');
        } else if (actionId.startsWith('chart_type_kpi_')) {
            return await handleChartType(payload, 'kpi');
        } else if (actionId.startsWith('chart_type_area_')) {
            return await handleChartType(payload, 'area');
        } else if (actionId.startsWith('follow_up_')) {
            return await handleFollowUpQuestion(payload);
        }

        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Unknown action: ${actionId}`
                }
            }]
        };
    } catch (error) {
        console.error('Error in handleslackInteraction:', error);
        return {
            blocks: [{
                type: "section",
                text: {
                    type: "mrkdwn",
                    text: `❌ Error processing request: ${error instanceof Error ? error.message : 'Unknown error'}`
                }
            }]
        };
    }
}