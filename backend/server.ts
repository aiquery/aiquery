import path from 'path';
import dotenv from 'dotenv';
dotenv.config();
const rootEnv = path.resolve(process.cwd(), '..', '.env');
dotenv.config({ path: rootEnv, override: true });

import express, { Application } from 'express';
import cors from 'cors';
import routes from './routes/routes';
import { createSlackApp } from './services/slack/slack.service';

import fs from 'fs';
import crypto from 'crypto';
import { llm, resolveAnthropicModelId } from './services/llm/llm.service';
import {
  getFinalExecutedQuery as getFinalExecutedBigQueryQuery,
  isSafeToRun as isSafeToRunBigQuery,
  testBigQueryConnection,
} from './services/data_sources/bigquery.service';
import { getFinalExecutedQuery as getFinalExecutedRedshiftQuery, isSafeToRun as isSafeToRunRedshift } from './services/data_sources/redshift.service';
import { getFinalExecutedQuery as getFinalExecutedSQLServerQuery, isSafeToRun as isSafeToRunSQLServer } from './services/data_sources/azuresql.service';
import { getFinalExecutedQuery as getFinalExecutedSnowflakeQuery, isSafeToRun as isSafeToRunSnowflake } from './services/data_sources/snowflake.service';
import { getFinalExecutedQuery as getFinalExecutedMySQLQuery, isSafeToRun as isSafeToRunMySQL } from './services/data_sources/mysql.service';
import { getFinalExecutedQuery as getFinalExecutedPostgreSQLQuery, isSafeToRun as isSafeToRunPostgreSQL } from './services/data_sources/postgresql.service';
import { getFinalExecutedQuery as getFinalExecutedDatabricksQuery, isSafeToRun as isSafeToRunDatabricks } from './services/data_sources/databricks.service';
import { visualizationService } from './services/visualization';
import { QueryExecutor, DataSourceConfig, DataSourceType } from './services/query/query-executor';
import { createAirtableClient } from './services/data_sources/airtable.service';
import { validateRedshiftConnection } from './services/data_sources/redshift.service';
import { validateAzureSQLConnection } from './services/data_sources/azuresql.service';
import { validateSnowflakeConnection } from './services/data_sources/snowflake.service';
import { validateMySQLConnection } from './services/data_sources/mysql.service';
import { validatePostgreSQLConnection } from './services/data_sources/postgresql.service';
import { validateDatabricksConnection } from './services/data_sources/databricks.service';
import { fetchBigQueryTableSchemas, fetchPostgresSQLTableSchemas, fetchRedshiftTableSchemas, fetchAzureSQLTableSchemas, fetchMySQLTableSchemas, fetchSnowflakeTableSchemas, fetchDatabricksTableSchemas, fetchDatabricksCatalogs, fetchDatabricksSchemas, createRAGIndex, getRagIndicesRoot, getRAGIndex, retrieveRAGContext, getAllRAGIndexes, addQuestionToRAGIndex, deleteRAGIndex, deleteTablesFromRAGIndex, deleteQuestionsFromRAGIndex, updateTableInRAGIndex, updateQuestionInRAGIndex } from './services/rag_service/rag.service';
import { initializeDatabase, testDatabaseConnection, getDatabasePool, getDatabaseConnectionIdentity } from './services/database';
import { userService } from './services/user_account/user-service';
import { connectionConfigService } from './services/connection/connection-config-service';
import { thirdPartyService } from './services/connection/third-party-service';
import { llmSettingsService } from './services/connection/llm-settings-service';
import { memberService } from './services/user_account/member-service';
import { workspaceService } from './services/workspace/workspace-service';
import { subscriptionService, PlanName, PlanType } from './services/user_account/subscription-service';
import { paymentService } from './services/user_account/payment-service';
import { usageTrackingService } from './services/user_account/usage-tracking-service';
import { notificationService } from './services/user_account/notification-service';
import { chatHistoryService } from './services/query/chat-history-service';
import { buildExecutionSteps } from './lib/execution-steps';
import { generateFollowUpSuggestions } from './services/query/follow-up-suggestions.service';
import { verifySlackSignature, handleSlackChallenge, processSlackEvent, getSlackConfigForUser } from './services/slack/slack-handler';
import axios from 'axios';
import FormData from 'form-data';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { buildUploadedTabularContextFromWebBuffers } from './services/slack/uploaded-tabular-context';
import { authenticateToken, optionalAuth, requireAdmin, AuthenticatedRequest } from './middleware/auth';
import { slackFileUploadService } from './services/slack/slack_file_upload';
import { getLLMConfig, LLMConfig, LLMProvider, parseLLMProviderString } from './helpers/llm-config';
import { crawlWebsiteContent } from './services/crawler/website-crawler';
import { emailVerificationService } from './services/user_account/email-verification-service';
import * as resendService from './services/email/resend-service';
import stripeRouter, { stripeWebhookHandler } from './routes/stripe-routes';
import * as stripeService from './services/payment/stripe-service';


const app: Application = express();
const PORT = parseInt(process.env.PORT || '3000', 10);

function normalizeSnowflakeAccountInput(input?: string): string {
  if (!input) return '';
  let value = String(input).trim();
  value = value.replace(/^https?:\/\//i, '');
  value = value.replace(/\/.*$/, '');
  while (/\.snowflakecomputing\.com$/i.test(value)) {
    value = value.replace(/\.snowflakecomputing\.com$/i, '');
  }
  return value;
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Datasource-Config'],
    credentials: true,
  })
);

app.use(express.urlencoded({ extended: true }));

// In-memory cache for processed Slack events (to prevent duplicate processing)
// In production, use Redis or a database for distributed systems
const processedSlackEvents = new Set<string>();

// Clean up old event IDs periodically
setInterval(() => {
  if (processedSlackEvents.size > 1000) {
      processedSlackEvents.clear();
      console.log('🧹 Cleared Slack event cache');
  }
}, 10 * 60 * 1000); // Every 10 minutes

// Stripe + Slack webhooks MUST be registered BEFORE express.json().
// If express.json() runs first, req.body is parsed and JSON.stringify(req.body) will NOT match
// the raw bytes Slack signed — signature verification fails for subsequent Events API requests.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);

// POST /api/slack/events - Slack Events API webhook
app.post('/api/slack/events', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
      let body: string;
      if (Buffer.isBuffer(req.body)) {
          body = req.body.toString('utf8');
      } else if (typeof req.body === 'string') {
          body = req.body;
      } else {
          console.warn('⚠️ Body was already parsed, stringifying back for signature verification');
          body = JSON.stringify(req.body);
      }

      let payload: any;
      try {
          payload = JSON.parse(body);
      } catch (e: any) {
          console.error('❌ JSON parse error:', e.message);
          console.error('Body content:', body);
          return res.status(400).json({ error: 'Invalid JSON payload', details: e.message });
      }

      if (payload.type === 'url_verification') {
          if (payload.challenge) {
              console.log('✅ Slack URL verification challenge received');
              console.log('Challenge value:', payload.challenge);
              return res.status(200).json({ challenge: payload.challenge });
          } else {
              console.error('❌ URL verification challenge missing challenge value');
              console.error('Payload:', JSON.stringify(payload, null, 2));
              return res.status(400).json({ error: 'Missing challenge in URL verification request' });
          }
      }

      const event = payload.event;

      const eventId = event ? `${payload.team_id}_${event.ts}_${event.type}_${event.user || 'unknown'}` : null;

      if (eventId && processedSlackEvents.has(eventId)) {
          console.log('🔄 Duplicate Slack event detected, ignoring:', eventId);
          return res.status(200).send('');
      }

      if (
          event &&
          event.type === 'message' &&
          !(event as any).bot_id &&
          (event as any).subtype !== 'bot_message' &&
          (event as any).subtype !== 'message_changed'
      ) {
          console.log('📥 Slack message received from user:', event.user);
      }

      const timestamp = req.headers['x-slack-request-timestamp'] as string;
      const signature = req.headers['x-slack-signature'] as string;

      if (!timestamp || !signature) {
          console.error('❌ Missing Slack signature headers');
          return res.status(401).json({ error: 'Missing Slack signature headers' });
      }

      if (!event) {
          return res.status(400).json({ error: 'No event in payload' });
      }

      if ((event as any).bot_id || (event as any).subtype === 'bot_message') {
          return res.status(200).send('');
      }

      if ((event as any).subtype === 'message_changed') {
          console.log('🚫 Ignoring message_changed event (triggered by our own message updates)');
          return res.status(200).send('');
      }

      if (event.type === 'message' && event.text) {
          const messageText = event.text.trim();
          if (messageText.includes('❌ Error') ||
              messageText.includes('No response was generated') ||
              messageText.includes('🤔 Thinking...') ||
              messageText.includes('Thinking...')) {
              console.log('🚫 Ignoring message that appears to be from our bot:', messageText.substring(0, 50));
              return res.status(200).send('');
          }
      }

      const users = await userService.getAllUsers();

      const teamId = payload.team_id;
      console.log(`🔍 Processing Slack event for team: ${teamId}, event type: ${event?.type}`);
      console.log(`🔍 Checking ${users.length} users for matching Slack config...`);

      let processed = false;
      let usersWithSlackConfig = 0;

      for (const user of users) {
          const slackConfig = await getSlackConfigForUser(user.id);
          if (slackConfig && slackConfig.config) {
              usersWithSlackConfig++;

              if (!slackConfig.config.signingSecret) {
                  console.log(`⚠️ User ${user.id} (${user.email || user.name}) has Slack config but no signing secret`);
                  continue;
              }

              if (slackConfig.config.teamId && slackConfig.config.teamId !== teamId) {
                  continue;
              }

              const isValid = verifySlackSignature(
                  slackConfig.config.signingSecret,
                  timestamp,
                  body,
                  signature
              );

              if (isValid) {
                  // message events use `channel`; file_shared and some payloads use `channel_id`
                  const slackChannelId = (event as any).channel || (event as any).channel_id;
                  console.log(`✅ Signature verified for user ${user.id} (${user.email || user.name})`);
                  console.log(`📋 Processing Slack event for user ${user.id} - will use this user's RAG and connection configs`);
                  const slackApiToken = slackConfig.config.apiToken;
                  if (!slackApiToken) {
                      console.warn(`⚠️ User ${user.id} has Slack config but no API token`);
                      continue;
                  }
                  if (slackApiToken && event.user) {
                      try {
                          const botInfoResponse = await axios.post('https://slack.com/api/auth.test', {}, {
                              headers: {
                                  'Authorization': `Bearer ${slackApiToken}`,
                                  'Content-Type': 'application/json'
                              }
                          });

                          if (botInfoResponse.data && botInfoResponse.data.user_id) {
                              const botUserId = botInfoResponse.data.user_id;
                              if (event.user === botUserId) {
                                  console.log(`🚫 Ignoring message from our own bot (user ID: ${botUserId})`);
                                  processed = true;
                                  break;
                              }
                          }
                      } catch (error) {
                          console.warn('⚠️ Could not verify bot user ID, continuing with caution');
                      }
                  }

                  if (event.type === 'message' && event.text) {
                      const messageText = event.text.trim();
                      if (messageText.includes('❌ Error') ||
                          messageText.includes('No response was generated') ||
                          messageText.includes('🤔 Thinking...') ||
                          messageText.includes('Thinking...')) {
                          console.log(`🚫 Ignoring message that contains our bot's error/thinking text`);
                          processed = true;
                          break;
                      }
                  }

                  if (eventId) {
                      processedSlackEvents.add(eventId);
                  }

                  let thinkingMessageTs: string | null = null;
                  let thinkingProgressInterval: NodeJS.Timeout | null = null;
                  if (slackApiToken && slackChannelId && event.type === 'message') {
                      try {
                          const focusTextRaw = typeof event.text === 'string' ? event.text.trim() : '';
                          const focusText = focusTextRaw.length > 160
                              ? `${focusTextRaw.slice(0, 157)}...`
                              : focusTextRaw;
                          const progressStates = [
                              { percent: 12, label: 'Understanding your goal' },
                              { percent: 28, label: 'Gathering context' },
                              { percent: 46, label: 'Drafting and checking SQL' },
                              { percent: 68, label: 'Running the query' },
                              { percent: 84, label: 'Summarizing results' },
                              { percent: 92, label: 'Finalizing response' }
                          ];
                          const orderedStepDetails = [
                              {
                                  title: 'Understanding your goal',
                                  detail: `Read your message and identified what you are asking for.${focusText ? ` Focus text: "${focusText}".` : ''}`,
                              },
                              {
                                  title: 'Gathering context',
                                  detail: 'Loaded your connection settings, checked permissions, and retrieved Knowledge Base snippets (schemas, table/column notes, business terms) so the query matches how your data is actually modeled.',
                              },
                              {
                                  title: 'Drafting and checking SQL',
                                  detail: 'Asked the model to generate SQL against your connected source, then ran safety checks (syntax, allowed operations, and alignment with the retrieved schema context) before execution.',
                              },
                              {
                                  title: 'Running the query',
                                  detail: 'Executed the statement on your data source, waited for rows, and captured row count and sample values for interpretation (timeouts and engine errors surface here).',
                              },
                              {
                                  title: 'Summarizing results',
                                  detail: 'When rows are returned, turns them into a concise answer with highlights and caveats. Refinement suggestions appear only after a real query result.',
                              },
                          ];
                          const renderProgressBar = (percent: number) => {
                              const totalSlots = 10;
                              const filled = Math.max(0, Math.min(totalSlots, Math.round((percent / 100) * totalSlots)));
                              return `${'█'.repeat(filled)}${'░'.repeat(totalSlots - filled)}`;
                          };
                          const buildThinkingText = (stateIndex: number) => {
                              const safeIndex = Math.max(0, Math.min(progressStates.length - 1, stateIndex));
                              const state = progressStates[safeIndex];
                              const visibleStepCount = Math.max(1, Math.min(orderedStepDetails.length, safeIndex + 1));
                              const orderedStepLines: string[] = [];
                              for (let i = 0; i < visibleStepCount; i += 1) {
                                  const step = orderedStepDetails[i];
                                  const isCurrentStep = i === visibleStepCount - 1;
                                  const marker = isCurrentStep ? '⏳' : '✅';
                                  orderedStepLines.push(`*${step.title}*`);
                                  orderedStepLines.push(step.detail);
                                  orderedStepLines.push(marker);
                                  if (i < visibleStepCount - 1) {
                                      orderedStepLines.push('');
                                  }
                              }
                              return [
                                  '🤔 *Kira is working on your request*',
                                  `*Progress:* ${state.percent}% \`${renderProgressBar(state.percent)}\``,
                                  `_Current step: ${state.label}_`,
                                  '',
                                  ...orderedStepLines,
                              ].join('\n');
                          };
                          const thinkingPayload = {
                              channel: slackChannelId,
                              text: '🤔 Thinking...',
                              blocks: [{
                                  type: 'section',
                                  text: {
                                      type: 'mrkdwn',
                                      text: buildThinkingText(0)
                                  }
                              }]
                          };

                          console.log(`📤 Sending "Thinking..." message to Slack channel ${slackChannelId}...`);
                          const thinkingResponse = await axios.post('https://slack.com/api/chat.postMessage', thinkingPayload, {
                              headers: {
                                  'Authorization': `Bearer ${slackApiToken}`,
                                  'Content-Type': 'application/json'
                              }
                          });

                          if (thinkingResponse.data && thinkingResponse.data.ok && thinkingResponse.data.ts) {
                              thinkingMessageTs = thinkingResponse.data.ts;
                              console.log(`✅ "Thinking..." message posted with ts: ${thinkingMessageTs}`);
                              let progressIndex = 0;
                              let smoothPercent = progressStates[0].percent;
                              thinkingProgressInterval = setInterval(async () => {
                                  if (!thinkingMessageTs) return;
                                  // Move steps forward quickly at first, then hold near completion.
                                  if (progressIndex < progressStates.length - 1) {
                                      progressIndex += progressIndex < 3 ? 1 : (Math.random() > 0.55 ? 1 : 0);
                                  }
                                  const targetPercent = progressStates[progressIndex].percent;
                                  if (smoothPercent < targetPercent) {
                                      smoothPercent = Math.min(targetPercent, smoothPercent + 2);
                                  } else if (smoothPercent > targetPercent) {
                                      smoothPercent = targetPercent;
                                  }
                                  const visibleStepIndex = Math.min(
                                      progressIndex,
                                      orderedStepDetails.length - 1
                                  );
                                  const progressText = buildThinkingText(visibleStepIndex).replace(
                                      /\*Progress:\* \d+% `[^`]+`/,
                                      `*Progress:* ${smoothPercent}% \`${renderProgressBar(smoothPercent)}\``
                                  );
                                  try {
                                      await axios.post('https://slack.com/api/chat.update', {
                                          channel: slackChannelId,
                                          ts: thinkingMessageTs,
                                          text: '🤔 Thinking...',
                                          blocks: [{
                                              type: 'section',
                                              text: {
                                                  type: 'mrkdwn',
                                                  text: progressText
                                              }
                                          }]
                                      }, {
                                          headers: {
                                              'Authorization': `Bearer ${slackApiToken}`,
                                              'Content-Type': 'application/json'
                                          }
                                      });
                                  } catch (progressError: any) {
                                      console.warn(`⚠️ Error updating progress indicator: ${progressError.message}`);
                                  }
                              }, 1800);
                          } else {
                              console.warn(`⚠️ Could not post "Thinking..." message: ${thinkingResponse.data?.error || 'Unknown error'}`);
                          }
                      } catch (thinkingError: any) {
                          console.warn(`⚠️ Error posting "Thinking..." message: ${thinkingError.message}`);
                      }
                  }

                  const forwardedProto = (req.headers['x-forwarded-proto'] as string) || req.protocol;
                  const apiBaseUrl = process.env.API_BASE_URL || `${forwardedProto}://${req.get('host')}`;
                  console.log(`🔗 API Base URL: ${apiBaseUrl}`);
                  const response = await processSlackEvent(event, user.id, apiBaseUrl);
                  if (thinkingProgressInterval) {
                      clearInterval(thinkingProgressInterval);
                      thinkingProgressInterval = null;
                  }
                  console.log(`📨 Response from processSlackEvent: text=${response.text ? 'present' : 'missing'}, blocks=${response.blocks ? `array(${response.blocks.length})` : 'missing'}`);

                  if (response.text || response.blocks) {
                      if (slackApiToken && slackChannelId) {
                          try {
                              const messagePayload: any = {
                                  channel: slackChannelId,
                                  text: response.text || 'Query Results'
                              };

                              if (response.blocks && response.blocks.length > 0) {
                                  messagePayload.blocks = response.blocks;
                              }

                              if (thinkingMessageTs) {
                                  try {
                                      messagePayload.ts = thinkingMessageTs;
                                      console.log(`📤 Updating "Thinking..." message (ts: ${thinkingMessageTs}) with actual response...`);
                                      const updateResponse = await axios.post('https://slack.com/api/chat.update', messagePayload, {
                                          headers: {
                                              'Authorization': `Bearer ${slackApiToken}`,
                                              'Content-Type': 'application/json'
                                          }
                                      });

                                      if (updateResponse.data && updateResponse.data.ok) {
                                          console.log(`✅ Updated "Thinking..." message with actual response`);
                                      } else {
                                          console.warn(`⚠️ Failed to update message, posting new message instead: ${updateResponse.data?.error || 'Unknown error'}`);
                                          delete messagePayload.ts;
                                          const slackResponse = await axios.post('https://slack.com/api/chat.postMessage', messagePayload, {
                                              headers: {
                                                  'Authorization': `Bearer ${slackApiToken}`,
                                                  'Content-Type': 'application/json'
                                              }
                                          });

                                          if (slackResponse.data && slackResponse.data.ok) {
                                              console.log(`✅ Sent response to Slack channel ${slackChannelId}`);
                                          } else {
                                              console.error(`❌ Slack API error: ${slackResponse.data.error || 'Unknown error'}`);
                                          }
                                      }
                                  } catch (updateError: any) {
                                      console.warn(`⚠️ Error updating message, posting new message instead: ${updateError.message}`);
                                      delete messagePayload.ts;
                                      const slackResponse = await axios.post('https://slack.com/api/chat.postMessage', messagePayload, {
                                          headers: {
                                              'Authorization': `Bearer ${slackApiToken}`,
                                              'Content-Type': 'application/json'
                                          }
                                      });

                                      if (slackResponse.data && slackResponse.data.ok) {
                                          console.log(`✅ Sent response to Slack channel ${slackChannelId}`);
                                      } else {
                                          console.error(`❌ Slack API error: ${slackResponse.data.error || 'Unknown error'}`);
                                      }
                                  }
                              } else {
                                  console.log(`📤 Sending message to Slack channel ${slackChannelId}...`);
                                  const slackResponse = await axios.post('https://slack.com/api/chat.postMessage', messagePayload, {
                                      headers: {
                                          'Authorization': `Bearer ${slackApiToken}`,
                                          'Content-Type': 'application/json'
                                      }
                                  });

                                  if (slackResponse.data && slackResponse.data.ok) {
                                      console.log(`✅ Sent response to Slack channel ${slackChannelId}`);
                                  } else {
                                      console.error(`❌ Slack API error: ${slackResponse.data.error || 'Unknown error'}`);
                                      console.error(`❌ Slack API response:`, JSON.stringify(slackResponse.data, null, 2));
                                  }
                              }
                          } catch (slackError: any) {
                              console.error('❌ Error sending message to Slack:', slackError.message);
                              if (slackError.response) {
                                  console.error('❌ Slack API error response:', JSON.stringify(slackError.response.data, null, 2));
                              }
                              if (eventId) {
                                  processedSlackEvents.delete(eventId);
                              }
                          }
                      } else {
                          console.warn(`⚠️ Cannot send response: slackApiToken=${!!slackApiToken}, channel=${slackChannelId}`);
                      }
                  } else {
                      console.warn(`⚠️ No response to send: response.text=${response.text}, response.blocks=${response.blocks}`);
                      if (thinkingMessageTs && slackApiToken && slackChannelId) {
                          try {
                              await axios.post('https://slack.com/api/chat.delete', {
                                  channel: slackChannelId,
                                  ts: thinkingMessageTs
                              }, {
                                  headers: {
                                      'Authorization': `Bearer ${slackApiToken}`,
                                      'Content-Type': 'application/json'
                                  }
                              });
                              console.log('🗑️ Deleted thinking message due to no response');
                          } catch (error: any) {
                              console.error('Error deleting thinking message:', error.message);
                              try {
                                  await axios.post('https://slack.com/api/chat.update', {
                                      channel: slackChannelId,
                                      ts: thinkingMessageTs,
                                      text: 'Response unavailable',
                                      blocks: [{
                                          type: 'section',
                                          text: {
                                              type: 'mrkdwn',
                                              text: '⚠️ *Response unavailable*\nPlease try your query again.'
                                          }
                                      }]
                                  }, {
                                      headers: {
                                          'Authorization': `Bearer ${slackApiToken}`,
                                          'Content-Type': 'application/json'
                                      }
                                  });
                              } catch (updateError) {
                                  console.error('Error updating thinking message:', updateError);
                              }
                          }
                      }
                  }

                  processed = true;
                  break;
              }
          } else {
              if (slackConfig && slackConfig.config && slackConfig.config.signingSecret) {
                  console.log(`❌ Signature verification failed for user ${user.id} (${user.email || user.name})`);
              }
          }
      }

      if (!processed) {
          console.warn('❌ Could not verify Slack signature or find matching user');
          console.warn(`   Team ID: ${teamId}`);
          console.warn(`   Event type: ${event?.type}`);
          console.warn(`   Total users: ${users.length}`);
          console.warn(`   Users with Slack config: ${usersWithSlackConfig}`);
          console.warn(`   Make sure the signing secret in your Slack app configuration matches the one saved in the database.`);
      }

      res.status(200).send('');
  } catch (error: any) {
      console.error('Error processing Slack event:', error);
      res.status(500).json({ error: 'Failed to process Slack event' });
  }
});

// ─── Slack Bot (before express.json) ─────────────────────────────────────────
const slackApp = createSlackApp(app);

// ─── JSON Body Parser ─────────────────────────────────────────────────────────
// Large payloads: chat sends `uploadedTabularContext` (sample rows JSON) — must exceed 2mb for big sheets.
app.use(express.json({ limit: '50mb' }));

// Log JSON body errors (e.g. 413) before other handlers — otherwise /api/chat fails with no handler log.
app.use((err: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
  const e = err as { type?: string; status?: number; message?: string };
  if (e?.type === 'entity.too.large' || e?.status === 413) {
    console.error('[api] JSON body too large', req.method, req.path, e?.message);
    return res.status(413).json({
      error: 'Payload too large',
      message: 'Request body exceeds server limit. Try a smaller file or fewer rows.',
    });
  }
  next(err);
});

// In-app chat: log every POST /api/chat that passes JSON parse (before /api router).
app.use((req, res, next) => {
  if (req.method === 'POST' && req.path === '/api/chat') {
    const cl = req.headers['content-length'];
    console.log('[api/chat] inbound (after JSON parse)', new Date().toISOString(), {
      contentLength: typeof cl === 'string' ? cl : undefined,
    });
  }
  next();
});

// ─── Request Logging ──────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  const start = Date.now();
  _res.on('finish', () => {
    const duration = Date.now() - start;
    if (!req.path.startsWith('/slack')) {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} ${_res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// ─── REST API Routes (AIquery router: /api/health, /api/aiquery, etc.) ─────────
app.use('/api', routes);

// NOTE: Do not register a global 404 handler here — most API routes are defined
// later in this file (e.g. /api/auth/*). A catch-all 404 before those routes
// would make every such request return 404. See 404 + error handlers before app.listen.

// ─── Start is at the end of the file (single app.listen with DB + Slack init) ───

const localWebsiteContentFiles = [
  { label: 'LandingPage', file: path.resolve('frontend/src/components/LandingPage.tsx') },
  { label: 'Documentation', file: path.resolve('frontend/src/components/Documentation.tsx') },
  { label: 'Pricing', file: path.resolve('frontend/src/components/Pricing.tsx') },
  { label: 'PrivacyPolicy', file: path.resolve('frontend/src/components/PrivacyPolicy.tsx') },
  { label: 'Blog', file: path.resolve('frontend/src/components/Blog.tsx') }
];

const loadLocalWebsiteContent = (): string => {
  const sections: string[] = [];
  localWebsiteContentFiles.forEach(({ label, file }) => {
      if (fs.existsSync(file)) {
          const content = fs.readFileSync(file, 'utf8');
          sections.push(`SOURCE: ${label}\n${content}`);
      }
  });
  return sections.join('\n\n');
};

const maskSecret = (value?: string): string => {
  if (!value) return 'NOT SET';
  const trimmed = value.trim();
  if (!trimmed) return 'EMPTY';
  if (trimmed.length <= 8) return '***';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
};

// Load environment variables and log the source
const envResult = dotenv.config();
console.log('[Server Startup] ============================================');
console.log('[Server Startup] Environment Variable Loading Debug Info');
console.log('[Server Startup] ============================================');
console.log(`[Server Startup] Current working directory: ${process.cwd()}`);
console.log(`[Server Startup] .env file path: ${path.resolve('.env')}`);
console.log(`[Server Startup] .env file exists: ${fs.existsSync(path.resolve('.env'))}`);

if (envResult.error) {
  console.log(`[Server Startup] ERROR loading .env: ${envResult.error.message}`);
} else if (envResult.parsed) {
  console.log(`[Server Startup] .env file loaded successfully`);
  console.log(`[Server Startup] OPENAI_API_KEY in .env file: ${envResult.parsed.OPENAI_API_KEY ? `EXISTS (length: ${envResult.parsed.OPENAI_API_KEY.length}, masked: ${maskSecret(envResult.parsed.OPENAI_API_KEY)})` : 'NOT SET'}`);
  console.log(`[Server Startup] GEMINI_API_KEY in .env file: ${envResult.parsed.GEMINI_API_KEY ? `EXISTS (length: ${envResult.parsed.GEMINI_API_KEY.length}, masked: ${maskSecret(envResult.parsed.GEMINI_API_KEY)})` : 'NOT SET'}`);
  console.log(`[Server Startup] GEMINI_MODEL in .env file: ${envResult.parsed.GEMINI_MODEL ? `EXISTS (value: ${envResult.parsed.GEMINI_MODEL})` : 'NOT SET'}`);
  console.log(`[Server Startup] OPENAI_MODEL in .env file: ${envResult.parsed.OPENAI_MODEL ? `EXISTS (value: ${envResult.parsed.OPENAI_MODEL})` : 'NOT SET'}`);
  console.log(`[Server Startup] ANTHROPIC_API_KEY in .env file: ${envResult.parsed.ANTHROPIC_API_KEY ? `EXISTS (length: ${envResult.parsed.ANTHROPIC_API_KEY.length}, masked: ${maskSecret(envResult.parsed.ANTHROPIC_API_KEY)})` : 'NOT SET'}`);
  console.log(`[Server Startup] ANTHROPIC_MODEL in .env file: ${envResult.parsed.ANTHROPIC_MODEL ? `EXISTS (value: ${envResult.parsed.ANTHROPIC_MODEL})` : 'NOT SET'}`);

  // Show actual .env file content for API keys (masked)
  if (fs.existsSync(path.resolve('.env'))) {
      try {
          const envContent = fs.readFileSync(path.resolve('.env'), 'utf8');
          const lines = envContent.split('\n');
          console.log(`[Server Startup] .env file API key lines:`);
          lines.forEach((line, index) => {
              const trimmed = line.trim();
              if (
                  trimmed.startsWith('OPENAI_API_KEY') ||
                  trimmed.startsWith('GEMINI_API_KEY') ||
                  trimmed.startsWith('ANTHROPIC_API_KEY')
              ) {
                  // Show line number and masked value
                  const parts = trimmed.split('=');
                  if (parts.length >= 2) {
                      const keyName = parts[0];
                      const value = parts.slice(1).join('=');
                      const masked = value.length > 0 ? `${value.substring(0, 10)}...${value.substring(value.length - 5)}` : 'EMPTY';
                      console.log(`[Server Startup]   Line ${index + 1}: ${keyName}=${masked} (full length: ${value.length})`);
                  }
              }
          });
      } catch (err) {
          console.log(`[Server Startup] Error reading .env file: ${err}`);
      }
  }
} else {
  console.log(`[Server Startup] .env file is empty or has no variables`);
}

// Check system environment variables (these override .env file)
// On Windows, these might be set in System Properties > Environment Variables
// On Linux/Mac, these might be set in ~/.bashrc, ~/.zshrc, or /etc/environment
console.log(`[Server Startup] System environment variables (check if set in OS):`);
const sysOpenaiKey = process.env.OPENAI_API_KEY;
const sysGeminiKey = process.env.GEMINI_API_KEY;
const sysAnthropicKey = process.env.ANTHROPIC_API_KEY;
const sysAnthropicModel = process.env.ANTHROPIC_MODEL;
console.log(`[Server Startup] OPENAI_API_KEY from system: ${sysOpenaiKey ? `EXISTS (length: ${sysOpenaiKey.length}, masked: ${maskSecret(sysOpenaiKey)})` : 'NOT SET'}`);
console.log(`[Server Startup] GEMINI_API_KEY from system: ${sysGeminiKey ? `EXISTS (length: ${sysGeminiKey.length}, masked: ${maskSecret(sysGeminiKey)})` : 'NOT SET'}`);
console.log(`[Server Startup] ANTHROPIC_API_KEY from system: ${sysAnthropicKey ? `EXISTS (length: ${sysAnthropicKey.length}, masked: ${maskSecret(sysAnthropicKey)})` : 'NOT SET'}`);
console.log(`[Server Startup] ANTHROPIC_MODEL from system: ${sysAnthropicModel ? `EXISTS (value: ${sysAnthropicModel})` : 'NOT SET'}`);

// Check if system env overrides .env
if (envResult.parsed) {
  if (envResult.parsed.OPENAI_API_KEY && sysOpenaiKey && envResult.parsed.OPENAI_API_KEY !== sysOpenaiKey) {
      console.log(`[Server Startup] ⚠️  WARNING: System OPENAI_API_KEY overrides .env file value!`);
  }
  if (envResult.parsed.GEMINI_API_KEY && sysGeminiKey && envResult.parsed.GEMINI_API_KEY !== sysGeminiKey) {
      console.log(`[Server Startup] ⚠️  WARNING: System GEMINI_API_KEY overrides .env file value!`);
  }
  if (envResult.parsed.ANTHROPIC_API_KEY && sysAnthropicKey && envResult.parsed.ANTHROPIC_API_KEY !== sysAnthropicKey) {
      console.log(`[Server Startup] ⚠️  WARNING: System ANTHROPIC_API_KEY overrides .env file value!`);
  }
  if (envResult.parsed.ANTHROPIC_MODEL && sysAnthropicModel && envResult.parsed.ANTHROPIC_MODEL !== sysAnthropicModel) {
      console.log(`[Server Startup] ⚠️  WARNING: System ANTHROPIC_MODEL overrides .env file value!`);
  }
}

// Log final values that will be used
console.log(`[Server Startup] Final values (what the app will use):`);
console.log(`[Server Startup] process.env.OPENAI_API_KEY: ${sysOpenaiKey ? `EXISTS (length: ${sysOpenaiKey.length}, masked: ${maskSecret(sysOpenaiKey)})` : 'NOT SET'}`);
console.log(`[Server Startup] process.env.GEMINI_API_KEY: ${sysGeminiKey ? `EXISTS (length: ${sysGeminiKey.length}, masked: ${maskSecret(sysGeminiKey)})` : 'NOT SET'}`);
console.log(`[Server Startup] process.env.ANTHROPIC_API_KEY: ${sysAnthropicKey ? `EXISTS (length: ${sysAnthropicKey.length}, masked: ${maskSecret(sysAnthropicKey)})` : 'NOT SET'}`);
console.log(`[Server Startup] process.env.ANTHROPIC_MODEL: ${sysAnthropicModel ? `EXISTS (value: ${sysAnthropicModel})` : 'NOT SET'}`);
console.log('[Server Startup] ============================================');

// Helper function to upload file to Slack
// For images, uses files.upload API which displays images directly
// For other files, uses the external upload API
async function uploadFileToSlack(
  apiToken: string | undefined,
  fileBuffer: Buffer,
  filename: string,
  contentType: string,
  channelId: string,
  initialComment?: string
): Promise<{ success: boolean; error?: string }> {
  if (!apiToken) {
      return { success: false, error: 'API token is required' };
  }
  
  // For images, use files.upload API which displays images directly in the channel
  if (contentType.startsWith('image/') && channelId && /^[CGDZ]/.test(channelId)) {
      try {
          console.log(`📤 Uploading image using files.upload API...`);
          const form = new FormData();
          
          form.append('channels', channelId);
          form.append('file', fileBuffer, {
              filename: filename,
              contentType: contentType
          });
          form.append('filename', filename);
          if (initialComment) {
              form.append('initial_comment', initialComment);
          }
          
          const uploadResponse = await axios.post('https://slack.com/api/files.upload', form, {
              headers: {
                  'Authorization': `Bearer ${apiToken}`,
                  ...form.getHeaders()
              },
              maxContentLength: Infinity,
              maxBodyLength: Infinity
          });
          
          console.log(`📤 Files.upload response:`, JSON.stringify(uploadResponse.data, null, 2));
          
          if (uploadResponse.data.ok) {
              console.log(`📤 Image uploaded and displayed successfully`);
              return { success: true };
          } else {
              console.warn(`⚠️ Files.upload failed: ${uploadResponse.data.error}`);
              // Fall back to external upload API
          }
      } catch (uploadError: any) {
          console.warn(`⚠️ Files.upload error, falling back to external upload:`, uploadError.message);
          // Fall back to external upload API
      }
  }
  
  // For non-images or if files.upload fails, use external upload API
  try {
      // Step 1: Get upload URL
      // Slack API expects form-encoded data, not JSON
      console.log(`📤 Step 1: Requesting upload URL for "${filename}" (${fileBuffer.length} bytes)...`);
      const formData = new URLSearchParams();
      formData.append('filename', filename);
      formData.append('length', fileBuffer.length.toString());
      
      const getUploadUrlResponse = await axios.post('https://slack.com/api/files.getUploadURLExternal', formData.toString(), {
          headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8'
          }
      });
      
      console.log(`📤 Get upload URL response:`, JSON.stringify(getUploadUrlResponse.data, null, 2));
      
      if (!getUploadUrlResponse.data.ok) {
          return {
              success: false,
              error: getUploadUrlResponse.data.error || 'Failed to get upload URL'
          };
      }
      
      const { upload_url, file_id } = getUploadUrlResponse.data;
      if (!upload_url || !file_id) {
          return {
              success: false,
              error: 'Invalid response from getUploadURLExternal: missing upload_url or file_id'
          };
      }
      
      console.log(`📤 Step 2: Uploading file to external URL (file_id: ${file_id})...`);
      
      // Step 2: Upload file to the provided URL
      await axios.put(upload_url, fileBuffer, {
          headers: {
              'Content-Type': contentType,
              'Content-Length': fileBuffer.length.toString()
          },
          maxContentLength: Infinity,
          maxBodyLength: Infinity
      });
      
      console.log(`📤 File uploaded to external URL successfully`);
      
      // Step 3: Complete the upload
      // Build the complete upload payload according to Slack API spec
      const completePayload: any = {
          files: [{
              id: file_id,
              title: filename
          }]
      };
      
      // Channel ID must be valid format (starts with C, G, D, or Z)
      // D09KAJ4R2SC is a DM channel (starts with D), so it's valid
      if (channelId && /^[CGDZ]/.test(channelId)) {
          completePayload.channel_id = channelId;
          console.log(`📤 Step 3: Completing upload to channel: ${channelId}`);
      } else {
          console.warn(`⚠️ Channel ID "${channelId}" is invalid or missing. File will be uploaded but not shared to channel.`);
      }
      
      // initial_comment is optional
      if (initialComment) {
          completePayload.initial_comment = initialComment;
      }
      
      console.log(`📤 Complete upload payload:`, JSON.stringify(completePayload, null, 2));
      
      const completeResponse = await axios.post('https://slack.com/api/files.completeUploadExternal', completePayload, {
          headers: {
              'Authorization': `Bearer ${apiToken}`,
              'Content-Type': 'application/json'
          }
      });
      
      console.log(`📤 Complete upload response:`, JSON.stringify(completeResponse.data, null, 2));
      
      if (completeResponse.data.ok) {
          const uploadedFile = completeResponse.data.files && completeResponse.data.files[0];
          const fileId = uploadedFile?.id || file_id;
          
          // Step 4: Post a message with file attachment to make it visible
          // files.completeUploadExternal with channel_id shares the file, but doesn't create a visible message
          // We'll post a message that includes the file as an attachment
          if (channelId && /^[CGDZ]/.test(channelId) && fileId && contentType.startsWith('image/')) {
              console.log(`📤 Step 4: Posting file message to channel ${channelId}...`);
              try {
                  // Wait a moment for the file to be fully processed by Slack
                  await new Promise(resolve => setTimeout(resolve, 500));
                  
                  // Get file info to get the permalink
                  const fileInfoResponse = await axios.post('https://slack.com/api/files.info',
                      `file=${fileId}`,
                      {
                          headers: {
                              'Authorization': `Bearer ${apiToken}`,
                              'Content-Type': 'application/x-www-form-urlencoded'
                          }
                      }
                  );
                  
                  console.log(`📤 File info response:`, JSON.stringify(fileInfoResponse.data, null, 2));
                  
                  const filePermalink = fileInfoResponse.data.ok && fileInfoResponse.data.file 
                      ? fileInfoResponse.data.file.permalink 
                      : uploadedFile?.permalink;
                  
                  if (filePermalink) {
                      // Post message with file permalink - Slack should display it
                      // Use blocks to format the message nicely
                      const postMessagePayload = {
                          channel: channelId,
                          text: initialComment || '📊 Chart:',
                          blocks: [
                              {
                                  type: 'section',
                                  text: {
                                      type: 'mrkdwn',
                                      text: `${initialComment || '📊 Chart:'}\n<${filePermalink}|View Chart>`
                                  }
                              }
                          ],
                          unfurl_links: true,
                          unfurl_media: true
                      };
                      
                      const postMessageResponse = await axios.post('https://slack.com/api/chat.postMessage', postMessagePayload, {
                          headers: {
                              'Authorization': `Bearer ${apiToken}`,
                              'Content-Type': 'application/json'
                          }
                      });
                      
                      console.log(`📤 Post message response:`, JSON.stringify(postMessageResponse.data, null, 2));
                      
                      if (postMessageResponse.data.ok) {
                          console.log(`📤 File message posted to channel successfully`);
                      } else {
                          console.warn(`⚠️ Could not post file message:`, postMessageResponse.data.error);
                      }
                  } else {
                      console.warn(`⚠️ No file permalink available`);
                  }
              } catch (shareError: any) {
                  console.warn(`⚠️ Error posting file to channel:`, shareError.message);
                  if (shareError.response) {
                      console.warn(`⚠️ Error response:`, JSON.stringify(shareError.response.data, null, 2));
                  }
              }
          }
          
          console.log(`📤 File upload completed successfully and shared to channel`);
          return { success: true };
      } else {
          const errorMsg = completeResponse.data.error || 'Failed to complete upload';
          console.error(`❌ Upload failed: ${errorMsg}`);
          if (completeResponse.data.response_metadata) {
              console.error(`Response metadata:`, JSON.stringify(completeResponse.data.response_metadata, null, 2));
          }
          return {
              success: false,
              error: errorMsg
          };
      }
  } catch (error: any) {
      console.error('Error uploading file to Slack:', error);
      if (error.response) {
          console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
          console.error('Error response status:', error.response.status);
      }
      return {
          success: false,
          error: error.message || 'Unknown error during upload'
      };
  }
}

// POST /api/slack/interactive - Handle Slack interactive component callbacks (buttons)
// IMPORTANT: This endpoint MUST be registered before express.json() middleware
const handleSlackInteractiveMiddleware = express.urlencoded({ extended: true });

// Test endpoint to verify routing works
app.post('/api/slack/interactive/test', (req, res) => {
  console.log('✅ Test endpoint hit');
  res.status(200).json({ message: 'Slack interactive endpoint is reachable' });
});

// Handler function for Slack interactive endpoints (shared between /interactive and /interaction)
const handleSlackInteractive = async (req: express.Request, res: express.Response) => {
  console.log('🔵 ========== Slack /api/slack/interactive endpoint hit ==========');
  console.log('🔵 Request method:', req.method);
  console.log('🔵 Request URL:', req.url);
  console.log('🔵 Request headers:', JSON.stringify(req.headers, null, 2));
  
  try {
      console.log('📥 Slack interactive endpoint called');
      console.log('📥 Request body type:', typeof req.body);
      console.log('📥 Request body keys:', Object.keys(req.body || {}));
      console.log('📥 Request body payload exists:', !!req.body?.payload);
      
      if (!req.body || !req.body.payload) {
          console.error('❌ Missing payload in request body');
          console.error('❌ Request body:', JSON.stringify(req.body, null, 2));
          // Always acknowledge to Slack to avoid retries
          return res.status(200).send('');
      }
      
      let payload;
      try {
          payload = JSON.parse(req.body.payload);
          console.log('📥 Payload parsed successfully');
          console.log('📥 Payload type:', payload.type);
          console.log('📥 Payload actions count:', payload.actions?.length || 0);
      } catch (parseError: any) {
          console.error('❌ Error parsing payload:', parseError.message);
          console.error('❌ Payload string:', req.body.payload);
          return res.status(200).send(''); // Always acknowledge to Slack
      }
      
      console.log('📥 Action ID:', payload.actions?.[0]?.action_id);
      console.log('📥 Response ID:', payload.actions?.[0]?.value);
      
      const { type, actions, user, response_url, channel, message } = payload;
      
      if (type !== 'block_actions') {
          console.log('⚠️ Not a block_actions type, ignoring. Type:', type);
          return res.status(200).send('');
      }
      
      if (!actions || actions.length === 0) {
          console.log('⚠️ No actions in payload');
          return res.status(200).send('');
      }
      
      const action = actions[0];
      const actionId = action.action_id;
      const responseId = action.value;
      
      console.log('📥 Processing action:', actionId, 'for response:', responseId);
      
      // Get cached response data
      const responseCache = (global as any).slackResponseCache || new Map();
      const cachedData = responseCache.get(responseId);
      
      if (!cachedData) {
          console.error('❌ No cached data found for responseId:', responseId);
          console.error('❌ Available cache keys:', Array.from(responseCache.keys()));
          return res.status(200).json({
              text: '⚠️ Response data expired. Please ask your question again.',
              replace_original: false
          });
      }
      
      console.log('✅ Found cached data for responseId:', responseId);
      
      const { interpretation, sqlQuery, queryResults, userId } = cachedData;
      const sqlVisible = cachedData.sqlVisible || false;
      const chartGenerated = cachedData.chartGenerated || false;
      
      // Get Slack config for this user
      const slackConfig = await getSlackConfigForUser(userId);
      if (!slackConfig || !slackConfig.config.apiToken) {
          console.error('❌ Slack config not found for userId:', userId);
          return res.status(200).json({
              text: '⚠️ Slack configuration not found.',
              replace_original: false
          });
      }
      
      console.log('✅ Slack config found for userId:', userId);
      
      // Check if this is a new-style action ID (with responseId suffix) - route to slack_interactions
      if (actionId.startsWith('show_more_data_') ||
          actionId.startsWith('show_less_data_') ||
          actionId.startsWith('show_sql_') || 
          actionId.startsWith('hide_sql_') ||
          actionId.startsWith('sql_explanation_see_all_') ||
          actionId.startsWith('sql_explanation_show_less_') ||
          actionId.startsWith('explain_sql_') ||
          actionId.startsWith('edit_sql_') ||
          actionId.startsWith('run_sql_') ||
          actionId.startsWith('show_csv_') ||
          actionId.startsWith('hide_csv_') ||
          actionId.startsWith('plot_chart_') || 
          actionId.startsWith('hide_chart_') ||
          actionId.startsWith('download_csv_') || 
          actionId.startsWith('download_json_') ||
          actionId.startsWith('download_png_') ||
          actionId.startsWith('chart_type_') ||
          actionId.startsWith('follow_up_')) {
          
          console.log('✅ Routing to slack_interactions handler for action:', actionId);
          
          // ✅ BEST PRACTICE: Acknowledge immediately to avoid timeout (Slack requires response within 3 seconds)
          res.status(200).send('');
          console.log('✅ Acknowledged to Slack immediately');
          
          // ✅ Process interaction asynchronously in background
          (async () => {
              try {
                  console.log('🔄 Processing interaction asynchronously...');
                  const { handleslackInteraction } = await import('./services/slack/slack_interactions');
                  const result = await handleslackInteraction(payload);
                  
                  console.log('✅ Interaction processed, result:', {
                      hasBlocks: !!result?.blocks,
                      updateMessage: result?.updateMessage,
                      hasFilePath: !!result?.filePath
                  });
                  
                  if (result && result.blocks && result.blocks.length > 0) {
                      if (result.updateMessage && message?.ts) {
                          console.log('📤 Updating original message...');
                          // Update the original message
                          const { WebClient } = await import('@slack/web-api');
                          const webClient = new WebClient(slackConfig.config.apiToken);
                          await webClient.chat.update({
                              channel: channel.id,
                              ts: message.ts,
                              blocks: result.blocks,
                          });
                          console.log('✅ Message updated successfully');
                      } else {
                          console.log('📤 Posting new message via response_url...');
                          // Post as new message via response_url
                          await axios.post(response_url, {
                              text: result.blocks[0]?.text?.text || 'Response',
                              blocks: result.blocks,
                              replace_original: false
                          });
                          console.log('✅ Message posted successfully');
                      }
                  }
                  
                  // Handle file uploads if needed
                  if (result && result.filePath) {
                      console.log('📤 Uploading file:', result.filePath);
                      const { slackFileUploadService } = await import('./services/slack/slack_file_upload');
                      await slackFileUploadService.uploadFile(
                          channel.id,
                          result.filePath,
                          slackConfig.config.apiToken,
                          result.fileTitle || 'File',
                          result.fileComment || ''
                      );
                      slackFileUploadService.cleanupFile(result.filePath);
                      console.log('✅ File uploaded successfully');
                  }
              } catch (error: any) {
                  console.error('❌ Error processing async interaction:', error);
                  console.error('❌ Error stack:', error.stack);
                  // Send error message via response_url
                  try {
                      await axios.post(response_url, {
                          text: `❌ Error processing request: ${error.message || 'Unknown error'}`,
                          replace_original: false
                      });
                      console.log('✅ Error message sent to Slack');
                  } catch (postError: any) {
                      console.error('❌ Error posting error message:', postError);
                  }
              }
          })();
          
          return; // Already acknowledged
      }
      
      let responseBlocks: any[] = [];
      let responseText = '';
      let updateOriginalMessage = false;
      
      // Handle old-style button actions (for backward compatibility)
      if (actionId === 'toggle_sql' && sqlQuery) {
          // Toggle SQL visibility
          const newSqlVisible = !sqlVisible;
          cachedData.sqlVisible = newSqlVisible;
          responseCache.set(responseId, cachedData);
          
          // Update the original message to change button text and show/hide SQL
          updateOriginalMessage = true;
          responseText = newSqlVisible ? 'SQL Query shown' : 'SQL Query hidden';
      } else if (actionId === 'show_more_data' && queryResults && queryResults.length > 5) {
          // Helper function to convert a value to a CSV-safe string
          const valueToCSVString = (value: any): string => {
              if (value === null || value === undefined) return '';
              if (value instanceof Date) {
                  return value.toISOString().split('T')[0];
              }
              if (typeof value === 'object') {
                  if (value.value && typeof value.value === 'string') return value.value;
                  if (value.toString && value.toString !== Object.prototype.toString) {
                      const str = value.toString();
                      if (str !== '[object Object]') return str;
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
          
          const headers = Object.keys(queryResults[0]);
          const csvRows = [
              headers.join(','),
              ...queryResults.map((row: any) => 
                  headers.map(header => {
                      const value = row[header];
                      const str = valueToCSVString(value);
                      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                          return `"${str.replace(/"/g, '""')}"`;
                      }
                      return str;
                  }).join(',')
              )
          ];
          
          responseBlocks = [{
              type: 'section',
              text: {
                  type: 'mrkdwn',
                  text: `*All Data (${queryResults.length} rows):*\n\`\`\`\n${csvRows.join('\n')}\n\`\`\``
              }
          }];
          responseText = 'All Data';
      } else if (actionId === 'show_chart' || actionId.startsWith('chart_type_')) {
          if (!queryResults || queryResults.length === 0) {
              // Acknowledge immediately
              res.status(200).json({
                  text: '⚠️ No data available for chart generation.',
                  replace_original: false
              });
              return;
          }
          
          // Determine chart type
          let chartType: string | undefined;
          if (actionId.startsWith('chart_type_')) {
              chartType = actionId.replace('chart_type_', '');
          }
          
          // CRITICAL: Acknowledge immediately to avoid timeout (Slack requires response within 3 seconds)
          res.status(200).json({
              text: '📊 Generating chart... This may take a few seconds.',
              replace_original: false
          });
          
          // Process chart generation asynchronously (after acknowledging)
          (async () => {
              try {
                  console.log(`📊 Generating chart with type: ${chartType || 'auto'}`);
                  
                  // Generate chart
                  const { visualizationService } = await import('./services/visualization');
                  const vizResult = await visualizationService.generateLLMVisualization({
                      data: queryResults,
                      question: interpretation || 'Visualize this data',
                      chartType: chartType
                  });
                  
                  console.log(`📊 Chart generation result:`, vizResult.success ? 'success' : vizResult.error);
                  
                  if (vizResult.success && vizResult.imagePath) {
                      // Upload chart image to Slack using the working project's approach
                      console.log(`📊 Uploading chart from path: ${vizResult.imagePath}`);
                      try {
                          const channelId = channel.id || '';
                          if (!channelId) {
                              throw new Error('Channel ID is required');
                          }
                          if (!slackConfig.config.apiToken) {
                              throw new Error('Slack API token is required');
                          }
                          const uploadResult = await slackFileUploadService.uploadFile(
                              channelId,
                              vizResult.imagePath,
                              slackConfig.config.apiToken,
                              'Data Visualization',
                              `📊 Chart${chartType ? ` (${chartType})` : ''}:`
                          );
                          
                          if (uploadResult.success) {
                              console.log('Visualization uploaded successfully to Slack');
                              // Send success message via response_url
                              await axios.post(response_url, {
                                  text: '✅ Chart generated and uploaded successfully!',
                                  replace_original: false
                              });
                              cachedData.chartGenerated = true;
                              responseCache.set(responseId, cachedData);
                              // Clean up the temporary file
                              slackFileUploadService.cleanupFile(vizResult.imagePath);
                          } else {
                              // Only log error to console, don't post error message to Slack
                              // The file might still be visible even if the response check fails
                              console.log('Upload result reported failure, but checking if file is visible:', uploadResult.error);
                              // Don't post error message - if chart is visible, that's what matters
                              // Clean up the temporary file
                              slackFileUploadService.cleanupFile(vizResult.imagePath);
                          }
                      } catch (uploadError: any) {
                          // Only log error to console, don't post error message to Slack
                          // The upload might still succeed even if there's an exception
                          console.error('Error during upload process (file may still be visible):', uploadError);
                          // Clean up the temporary file
                          if (vizResult.imagePath) {
                              slackFileUploadService.cleanupFile(vizResult.imagePath);
                          }
                      }
                  } else {
                      // Send error message via response_url
                      await axios.post(response_url, {
                          text: `❌ Failed to generate chart: ${vizResult.error || 'Unknown error'}`,
                          replace_original: false
                      });
                  }
              } catch (chartError: any) {
                  console.error('Error generating chart:', chartError);
                  // Send error message via response_url
                  await axios.post(response_url, {
                      text: `❌ Error generating chart: ${chartError.message || 'Unknown error'}`,
                      replace_original: false
                  });
              }
          })();
          
          // Don't set responseBlocks or responseText here - already acknowledged
          return;
      } else if (actionId === 'download_csv' && queryResults) {
          // Acknowledge immediately
          res.status(200).send('');
          
          // Process CSV upload asynchronously (after acknowledging)
          (async () => {
              try {
                  // Helper function to convert a value to a CSV-safe string
                  const valueToCSVString = (value: any): string => {
                      if (value === null || value === undefined) return '';
                      
                      // Handle Date objects
                      if (value instanceof Date) {
                          return value.toISOString().split('T')[0]; // Format as YYYY-MM-DD
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
                  
                  // Convert to CSV
                  const headers = Object.keys(queryResults[0]);
                  const csvRows = [
                      headers.join(','),
                      ...queryResults.map((row: any) => 
                          headers.map(header => {
                              const value = row[header];
                              const str = valueToCSVString(value);
                              if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                                  return `"${str.replace(/"/g, '""')}"`;
                              }
                              return str;
                          }).join(',')
                      )
                  ];
                  const csvContent = csvRows.join('\n');
                  
                  // Create temporary file (using same directory as working project)
                  const tempDir = path.join(require('os').tmpdir(), 'bigquery_downloads');
                  if (!fs.existsSync(tempDir)) {
                      fs.mkdirSync(tempDir, { recursive: true });
                  }
                  const csvFilename = `query_results_${Date.now()}.csv`;
                  const csvFilePath = path.join(tempDir, csvFilename);
                  
                  // Write CSV to temporary file
                  fs.writeFileSync(csvFilePath, csvContent, 'utf8');
                  
                  // Upload using the service (same approach as charts)
                  const channelId = channel.id || '';
                  if (!channelId) {
                      throw new Error('Channel ID is required');
                  }
                  if (!slackConfig.config.apiToken) {
                      throw new Error('Slack API token is required');
                  }
                  
                  const csvUploadResult = await slackFileUploadService.uploadFile(
                      channelId,
                      csvFilePath,
                      slackConfig.config.apiToken,
                      'Query Results (CSV)',
                      '📥 CSV file:'
                  );
                  
                  // Clean up temporary file
                  slackFileUploadService.cleanupFile(csvFilePath);
                  
                  if (!csvUploadResult.success) {
                      console.error('Failed to upload CSV:', csvUploadResult.error);
                      // Send error message via response_url
                      await axios.post(response_url, {
                          text: `❌ Failed to upload CSV: ${csvUploadResult.error || 'Unknown error'}`,
                          replace_original: false
                      });
                  }
              } catch (csvError: any) {
                  console.error('Error uploading CSV:', csvError);
                  // Send error message via response_url
                  await axios.post(response_url, {
                      text: `❌ Error uploading CSV: ${csvError.message || 'Unknown error'}`,
                      replace_original: false
                  });
              }
          })();
          
          // Don't set responseText here - already acknowledged
          return;
      } else if (actionId === 'download_json' && queryResults) {
          // Acknowledge immediately
          res.status(200).send('');
          
          // Process JSON upload asynchronously (after acknowledging)
          (async () => {
              try {
                  // Convert to JSON
                  const jsonContent = JSON.stringify(queryResults, null, 2);
                  
                  // Create temporary file (using same directory as working project)
                  const tempDir = path.join(require('os').tmpdir(), 'bigquery_downloads');
                  if (!fs.existsSync(tempDir)) {
                      fs.mkdirSync(tempDir, { recursive: true });
                  }
                  const jsonFilename = `query_results_${Date.now()}.json`;
                  const jsonFilePath = path.join(tempDir, jsonFilename);
                  
                  // Write JSON to temporary file
                  fs.writeFileSync(jsonFilePath, jsonContent, 'utf8');
                  
                  // Upload using the service (same approach as charts)
                  const channelId = channel.id || '';
                  if (!channelId) {
                      throw new Error('Channel ID is required');
                  }
                  if (!slackConfig.config.apiToken) {
                      throw new Error('Slack API token is required');
                  }
                  
                  const jsonUploadResult = await slackFileUploadService.uploadFile(
                      channelId,
                      jsonFilePath,
                      slackConfig.config.apiToken,
                      'Query Results (JSON)',
                      '📄 JSON file:'
                  );
                  
                  // Clean up temporary file
                  slackFileUploadService.cleanupFile(jsonFilePath);
                  
                  if (!jsonUploadResult.success) {
                      console.error('Failed to upload JSON:', jsonUploadResult.error);
                      // Send error message via response_url
                      await axios.post(response_url, {
                          text: `❌ Failed to upload JSON: ${jsonUploadResult.error || 'Unknown error'}`,
                          replace_original: false
                      });
                  }
              } catch (jsonError: any) {
                  console.error('Error uploading JSON:', jsonError);
                  // Send error message via response_url
                  await axios.post(response_url, {
                      text: `❌ Error uploading JSON: ${jsonError.message || 'Unknown error'}`,
                      replace_original: false
                  });
              }
          })();
          
          // Don't set responseText here - already acknowledged
          return;
      }
      
      // Send response back to Slack
      if (responseBlocks.length > 0 || responseText || updateOriginalMessage) {
          let responsePayload: any = {
              text: responseText || (updateOriginalMessage ? 'Query Results' : ''),
              replace_original: updateOriginalMessage
          };
          
          // If updating original message, reconstruct the full message with updated SQL visibility
          if (updateOriginalMessage && actionId === 'toggle_sql') {
              // Reconstruct the original message blocks
              const originalBlocks: any[] = [];
              
              // Add interpretation
              if (interpretation) {
                  originalBlocks.push({
                      type: 'section',
                      text: {
                          type: 'mrkdwn',
                          text: `*Response:*\n${interpretation}`
                      }
                  });
              }
              
              // Add SQL query if visible
              const currentSqlVisible = cachedData.sqlVisible || false;
              if (currentSqlVisible && sqlQuery) {
                  originalBlocks.push({
                      type: 'section',
                      text: {
                          type: 'mrkdwn',
                          text: `*SQL Query:*\n\`\`\`${sqlQuery}\`\`\``
                      }
                  });
              }
              
              // Add data results
              if (queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
                  // Helper function to convert a value to a CSV-safe string
                  const valueToCSVString = (value: any): string => {
                      if (value === null || value === undefined) return '';
                      if (value instanceof Date) {
                          return value.toISOString().split('T')[0];
                      }
                      if (typeof value === 'object') {
                          if (value.value && typeof value.value === 'string') return value.value;
                          if (value.toString && value.toString !== Object.prototype.toString) {
                              const str = value.toString();
                              if (str !== '[object Object]') return str;
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
                  
                  const headers = Object.keys(queryResults[0]);
                  const displayResults = queryResults.slice(0, 5);
                  const csvRows = [
                      headers.join(','),
                      ...displayResults.map((row: any) => 
                          headers.map(header => {
                              const value = row[header];
                              const str = valueToCSVString(value);
                              if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                                  return `"${str.replace(/"/g, '""')}"`;
                              }
                              return str;
                          }).join(',')
                      )
                  ];
                  
                  originalBlocks.push({
                      type: 'section',
                      text: {
                          type: 'mrkdwn',
                          text: `*Data Results (${queryResults.length} row${queryResults.length !== 1 ? 's' : ''}):*\n\`\`\`\n${csvRows.join('\n')}\n\`\`\``
                      }
                  });
                  
                  if (queryResults.length > 5) {
                      originalBlocks.push({
                          type: 'section',
                          text: {
                              type: 'mrkdwn',
                              text: `_Showing first 5 of ${queryResults.length} rows_`
                          },
                          accessory: {
                              type: 'button',
                              text: {
                                  type: 'plain_text',
                                  text: 'Show More Data'
                              },
                              action_id: 'show_more_data',
                              value: responseId
                          }
                      });
                  }
              }
              
              // Add action buttons with updated SQL button text
              const actionButtons: any[] = [];
              if (sqlQuery) {
                  actionButtons.push({
                      type: 'button',
                      text: {
                          type: 'plain_text',
                          text: currentSqlVisible ? '🙈 Hide SQL Query' : '📝 Show SQL Query'
                      },
                      action_id: 'toggle_sql',
                      value: responseId,
                      style: 'primary'
                  });
              }
              
              if (queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
                  actionButtons.push({
                      type: 'button',
                      text: {
                          type: 'plain_text',
                          text: '📊 Show Chart'
                      },
                      action_id: 'show_chart',
                      value: responseId
                  });
                  
                  actionButtons.push({
                      type: 'button',
                      text: {
                          type: 'plain_text',
                          text: '📥 Download CSV'
                      },
                      action_id: 'download_csv',
                      value: responseId
                  });
                  
                  actionButtons.push({
                      type: 'button',
                      text: {
                          type: 'plain_text',
                          text: '📄 Download JSON'
                      },
                      action_id: 'download_json',
                      value: responseId
                  });
              }
              
              if (actionButtons.length > 0) {
                  originalBlocks.push({
                      type: 'actions',
                      elements: actionButtons
                  });
              }
              
              // Add chart type buttons
              if (queryResults && Array.isArray(queryResults) && queryResults.length > 0) {
                  originalBlocks.push({
                      type: 'section',
                      text: {
                          type: 'mrkdwn',
                          text: '*Chart Types:*'
                      }
                  });
                  
                  originalBlocks.push({
                      type: 'actions',
                      elements: [
                          { type: 'button', text: { type: 'plain_text', text: '📊 Bar' }, action_id: 'chart_type_bar', value: responseId },
                          { type: 'button', text: { type: 'plain_text', text: '🥧 Pie' }, action_id: 'chart_type_pie', value: responseId },
                          { type: 'button', text: { type: 'plain_text', text: '📈 Line' }, action_id: 'chart_type_line', value: responseId },
                          { type: 'button', text: { type: 'plain_text', text: '⚪ Scatter' }, action_id: 'chart_type_scatter', value: responseId },
                          { type: 'button', text: { type: 'plain_text', text: '📊 Histogram' }, action_id: 'chart_type_histogram', value: responseId }
                      ]
                  });
              }
              
              responsePayload.blocks = originalBlocks;
          } else {
              // Normal response (not updating original message)
              responsePayload.blocks = responseBlocks;
          }
          
          await axios.post(response_url, responsePayload);
      }
      
      // Acknowledge the interaction
      console.log('✅ Sending final acknowledgment to Slack');
      res.status(200).send('');
  } catch (error: any) {
      console.error('❌ ========== ERROR handling Slack interactive component ==========');
      console.error('❌ Error message:', error.message);
      console.error('❌ Error stack:', error.stack);
      console.error('❌ Request body:', JSON.stringify(req.body, null, 2));
      // Always acknowledge to Slack to prevent retries
      res.status(200).send('');
  }
  console.log('🔵 ========== Slack interactive endpoint handler completed ==========');
};

// Register the handler for /api/slack/interactive
app.post('/api/slack/interactive', handleSlackInteractiveMiddleware, handleSlackInteractive);

// Also handle /api/slack/interaction (singular, no 'e') - Slack uses this endpoint name
app.post('/api/slack/interaction', handleSlackInteractiveMiddleware, handleSlackInteractive);

// Also handle /api/slack/interactions (with 's') - Slack sometimes uses this endpoint name
// This is just an alias that forwards to the same handler
app.post('/api/slack/interactions', handleSlackInteractiveMiddleware, handleSlackInteractive);

// JSON body limit is set once above (50mb) — do not add a second express.json() (double-parse breaks requests).

// Health check for Cloud Run / load balancers
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Stripe API routes: create-customer, create-checkout-session, subscriptions, billing-portal, etc.
app.use('/api/stripe', stripeRouter);

// Serve static files from the frontend build directory
const frontendBuildPath = path.join(__dirname, '../../frontend/dist');
if (fs.existsSync(frontendBuildPath)) {
  app.use(express.static(frontendBuildPath));
}

// API Routes

// POST /api/chat/grounded - Grounded website chatbot (Landing Page)
app.post('/api/chat/grounded', optionalAuth, async (req: AuthenticatedRequest, res: express.Response) => {
  try {
      const question = (req.body?.question || '').toString().trim();
      if (!question) {
          return res.status(400).json({ error: 'Question is required.' });
      }

      const normalizedQuestion = question.toLowerCase();
      const greetingPrefixMatch = normalizedQuestion.match(
          /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy|sup|what's up)\b[\s,!.]*/i
      );
      const remainderAfterGreetingPrefix = greetingPrefixMatch
          ? normalizedQuestion.slice(greetingPrefixMatch[0].length).trim()
          : normalizedQuestion;
      const hasLikelyFollowUpQuestion =
          !!greetingPrefixMatch &&
          remainderAfterGreetingPrefix.length > 0 &&
          (remainderAfterGreetingPrefix.includes('?') || remainderAfterGreetingPrefix.split(/\s+/).length >= 3);
      const isGreeting =
          !hasLikelyFollowUpQuestion &&
          /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy|sup|what's up)(\s+[a-z0-9_-]+)?[\s,!.?]*$/i.test(
              normalizedQuestion
          );
      if (isGreeting) {
          const localDate = new Date().toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric'
          });
          return res.json({
              answer: `Hello! Thanks for reaching out. Today is ${localDate}. How can I help you with AIquery?`
          });
      }

      const preferredProvider = parseLLMProviderString(
          typeof req.body?.llmProvider === 'string' ? req.body.llmProvider : undefined
      );
      const requestApiKey =
          typeof req.body?.llmApiKey === 'string' && req.body.llmApiKey.trim().length > 0
              ? req.body.llmApiKey.trim()
              : '';
      const requestModel =
          typeof req.body?.llmModel === 'string' && req.body.llmModel.trim().length > 0
              ? req.body.llmModel.trim()
              : undefined;
      const requestUseLightModel = req.body?.useLightModel === true || req.body?.useLightModel === 'true';

      const llmConfig: LLMConfig | null =
          preferredProvider && requestApiKey
              ? {
                    provider: preferredProvider,
                    apiKey: requestApiKey,
                    model: requestModel,
                    useLightModel: requestUseLightModel,
                }
              : await getLLMConfig(req.userId, preferredProvider);

      if (preferredProvider && requestApiKey) {
          console.log(
              `[LLM Config] source=request userId=${req.userId ?? 'anon'} provider=${preferredProvider} model=${requestModel || 'default'} endpoint=chat-grounded`
          );
      }
      if (!llmConfig) {
          return res.status(500).json({ error: 'LLM API key is not configured in environment variables.' });
      }

      const baseUrl = process.env.NODE_ENV === 'production'
          ? (process.env.PUBLIC_SITE_URL || 'https://aiquery.ai')
          : `${req.protocol}://${req.get('host')}`;

      const allowedPaths = process.env.NODE_ENV === 'production'
          ? [
              '/',
              '/features',
              '/docs',
              '/blog',
              '/faq',
              '/pricing',
              '/contact',
              '/privacy',
              '/terms'
          ]
          : [
              '/',
              '/docs',
              '/pricing',
              '/privacy'
          ];

      const allowedUrls = process.env.NODE_ENV === 'production'
          ? []
          : [
              baseUrl,
              `${baseUrl}/docs`,
              `${baseUrl}/pricing`,
              `${baseUrl}/privacy`
          ];

      const rawContent = await crawlWebsiteContent(baseUrl, {
          maxPages: 30,
          maxDepth: 2,
          allowedPaths,
          allowedUrls
      });

      let context = rawContent.slice(0, 12000);
      if (context.trim().length < 500) {
          const localContent = loadLocalWebsiteContent();
          context = `${context}\n\n${localContent}`.slice(0, 12000);
      }
      const fallback = 'Sorry, it is not relative to AIquery service, I can not answer your question.';
      if (!context.trim()) {
          return res.json({ answer: fallback });
      }

      const prompt = `You are Kira, the AI assistant for the AIquery website.
You MUST answer using ONLY the information provided in the WEBSITE CONTENT below.
If the answer is not explicitly supported by the content, reply with exactly:
"${fallback}"

WEBSITE CONTENT:
${context}

QUESTION: ${question}
ANSWER:`;

      llm.setProvider(llmConfig.provider);
      const answer = await llm.queryLLM(prompt, false, llmConfig.useLightModel, llmConfig.apiKey, llmConfig.model);

      res.json({
          answer: typeof answer === 'string' ? answer.trim() : String(answer)
      });
  } catch (error: any) {
      console.error('Error in grounded chatbot:', error);
      res.status(500).json({ error: 'Failed to generate response.' });
  }
});

/**
 * Detect when the user clearly asks about an uploaded file but the request has no tabular context.
 * (Prevents silent fallback to warehouse-only SQL.)
 */
function questionReferencesUploadWithoutContext(bodyQuestion: string): boolean {
  const q = bodyQuestion.trim().toLowerCase();
  if (!q) return false;
  if (q.includes('--- uploaded tabular data context ---')) return false;
  /** User is asking about THIS chat's attachment (avoid false positives like "what is an uploaded file?") */
  if (/\b(the|my|this)\s+uploaded\s+(file|sheet|spreadsheet|csv|data|table)\b/.test(q)) return true;
  if (q.includes('based on the upload')) return true;
  if (q.includes('from the upload')) return true;
  if (q.includes('from my upload')) return true;
  if (q.includes('from this upload')) return true;
  if (q.includes('this spreadsheet') && (q.includes('upload') || q.includes('attach'))) return true;
  if (q.includes('attached file') && (q.includes('based') || q.includes('from') || q.includes('analyze'))) return true;
  return false;
}

const UPLOAD_TABULAR_MARKER_START = '--- Uploaded Tabular Data Context ---';
const UPLOAD_TABULAR_MARKER_END = '--- End Uploaded Tabular Data Context ---';

/**
 * Slack (legacy) sends user text + tabular blob in one `question` field. Chat history should only
 * persist the user's words — not the sample rows / JSON block.
 */
function stripUploadedTabularDataBlockForHistory(text: string): string {
  const s = text ?? '';
  const i = s.indexOf(UPLOAD_TABULAR_MARKER_START);
  if (i === -1) return s.trim();
  const j = s.indexOf(UPLOAD_TABULAR_MARKER_END, i);
  if (j === -1) {
    return s.slice(0, i).trim();
  }
  const before = s.slice(0, i).trim();
  const after = s.slice(j + UPLOAD_TABULAR_MARKER_END.length).trim();
  const joined = [before, after].filter(Boolean).join('\n\n').trim();
  return joined.replace(/\n{3,}/g, '\n\n').trim();
}

function buildChatHistoryQuestionLabel(baseQuestion: string, uploadCtx: string | null, mergedQuestion: string): string {
  const strippedBase = stripUploadedTabularDataBlockForHistory(baseQuestion);
  if (strippedBase.length > 0) {
    return strippedBase;
  }
  if (uploadCtx || baseQuestion.includes(UPLOAD_TABULAR_MARKER_START)) {
    return '📎 Uploaded file (tabular data attached)';
  }
  return stripUploadedTabularDataBlockForHistory(mergedQuestion).slice(0, 4000);
}

/** Chat uploads saved under project \`frontend/temp\` for persistence + /api/chat replay. */
function getFrontendTempDir(): string {
  return path.resolve(process.cwd(), 'frontend', 'temp');
}

function ensureFrontendTempDir(): void {
  fs.mkdirSync(getFrontendTempDir(), { recursive: true });
}

/** Must match multer filename: \`uuid_originalsafe\` */
function isSafeChatTempFilename(name: string): boolean {
  const base = path.basename(name);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}_[\w.\-]+$/i.test(base);
}

function loadUploadedContextFromTempFiles(
  items: Array<{ storedName: string; originalName: string }>
): string {
  const tempDir = path.resolve(getFrontendTempDir());
  const parts: Array<{ originalname: string; buffer: Buffer }> = [];
  for (const item of items.slice(0, 2)) {
      const key = path.basename(item.storedName);
      if (!isSafeChatTempFilename(key)) {
          console.warn('[api/chat] skip invalid temp key:', item.storedName);
          continue;
      }
      const fullPath = path.join(tempDir, key);
      const resolved = path.resolve(fullPath);
      if (!resolved.startsWith(tempDir + path.sep)) {
          continue;
      }
      if (!fs.existsSync(resolved)) {
          console.warn('[api/chat] temp file missing:', resolved);
          continue;
      }
      try {
          const buf = fs.readFileSync(resolved);
          const on =
              item.originalName && item.originalName.trim().length > 0
                  ? path.basename(item.originalName)
                  : key.replace(/^[0-9a-f-]{36}_/i, '') || 'upload.csv';
          parts.push({ originalname: on, buffer: buf });
      } catch (e) {
          console.warn('[api/chat] read temp file failed:', key, e);
      }
  }
  if (parts.length === 0) {
      return '';
  }
  return buildUploadedTabularContextFromWebBuffers(parts);
}

/** Multipart field name \`file\` (Ellie-style); up to 2 files — parsed server-side like Slack. */
const chatUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024, files: 2 },
});

const chatTempDiskUpload = multer({
  storage: multer.diskStorage({
      destination: (_req, _file, cb) => {
          ensureFrontendTempDir();
          cb(null, getFrontendTempDir());
      },
      filename: (_req, file, cb) => {
          const safe = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '_');
          cb(null, `${uuidv4()}_${safe}`);
      },
  }),
  limits: { fileSize: 50 * 1024 * 1024, files: 2 },
});

function chatMultipartIfNeeded(req: express.Request, res: express.Response, next: express.NextFunction) {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    return chatUpload.array('file', 2)(req, res, (err) => {
      if (err) return next(err);
      next();
    });
  }
  next();
}

// POST /api/chat/upload-temp — persist CSV/XLSX under frontend/temp (then /api/chat references storedName)
app.post(
  '/api/chat/upload-temp',
  optionalAuth,
  chatTempDiskUpload.array('file', 2),
  async (req: express.Request, res: express.Response) => {
      try {
          const files = (req as express.Request & { files?: Express.Multer.File[] }).files;
          if (!files || !Array.isArray(files) || files.length === 0) {
              return res.status(400).json({ success: false, error: 'No file(s) uploaded' });
          }
          const cwd = process.cwd();
          return res.json({
              success: true,
              tempDir: 'frontend/temp',
              files: files.map((f) => ({
                  storedName: f.filename,
                  originalName: f.originalname,
                  relativePath: path.relative(cwd, f.path).replace(/\\/g, '/'),
              })),
          });
      } catch (e) {
          console.error('[api/chat/upload-temp]', e);
          return res.status(500).json({ success: false, error: 'Failed to save upload' });
      }
  }
);

// POST /api/chat - Handle natural language queries
app.post('/api/chat', optionalAuth, chatMultipartIfNeeded, async (req: AuthenticatedRequest, res) => {
  try {
      const reqFiles = (req as express.Request & { files?: Express.Multer.File[] }).files;
      let uploadedFromMultipart = '';
      if (reqFiles && Array.isArray(reqFiles) && reqFiles.length > 0) {
          uploadedFromMultipart = buildUploadedTabularContextFromWebBuffers(
              reqFiles.map((f) => ({
                  originalname: f.originalname || 'upload.csv',
                  buffer: f.buffer,
              }))
          );
      }

      let {
          question: bodyQuestion,
          userName,
          connectionConfig,
          llmProvider,
          llmApiKey,
          llmModel: requestLlmModelRaw,
          useLightModel,
          userId: bodyUserId,
          uploadedTabularContext,
      } = (req.body || {}) as Record<string, any>;

      if (typeof connectionConfig === 'string') {
          try {
              connectionConfig = JSON.parse(connectionConfig);
          } catch {
              connectionConfig = undefined;
          }
      }
      if (useLightModel === 'true') useLightModel = true;
      if (useLightModel === 'false') useLightModel = false;

      let tempUploadFilesRaw = (req.body as Record<string, unknown>).tempUploadFiles;
      if (typeof tempUploadFilesRaw === 'string') {
          try {
              tempUploadFilesRaw = JSON.parse(tempUploadFilesRaw) as unknown;
          } catch {
              tempUploadFilesRaw = undefined;
          }
      }
      let uploadedFromTempDisk = '';
      if (Array.isArray(tempUploadFilesRaw) && tempUploadFilesRaw.length > 0) {
          const items = tempUploadFilesRaw
              .filter((x: unknown) => x && typeof (x as { storedName?: string }).storedName === 'string')
              .map((x: { storedName: string; originalName?: string }) => ({
                  storedName: path.basename(String(x.storedName)),
                  originalName:
                      typeof x.originalName === 'string' && x.originalName.trim().length > 0
                          ? x.originalName
                          : String(x.storedName),
              }))
              .slice(0, 2);
          uploadedFromTempDisk = loadUploadedContextFromTempFiles(items);
      }

      // Priority: multipart buffers from this request > files saved under frontend/temp > JSON body string
      if (uploadedFromMultipart && uploadedFromMultipart.trim().length > 0) {
          uploadedTabularContext = uploadedFromMultipart;
      } else if (uploadedFromTempDisk && uploadedFromTempDisk.trim().length > 0) {
          uploadedTabularContext = uploadedFromTempDisk;
      }

      console.log('[api/chat] request received', {
          contentType: req.headers['content-type']?.slice(0, 40),
          bodyKeys: req.body && typeof req.body === 'object' ? Object.keys(req.body) : [],
          multipartFileCount: Array.isArray(reqFiles) ? reqFiles.length : 0,
          tempUploadFileCount: Array.isArray(tempUploadFilesRaw) ? tempUploadFilesRaw.length : 0,
          hasUploadedTabularContext: Boolean(
              typeof uploadedTabularContext === 'string' && String(uploadedTabularContext).length > 0
          ),
      });

      const baseQuestion =
          typeof bodyQuestion === 'string' ? bodyQuestion.trim() : String(bodyQuestion ?? '').trim();
      const uploadCtx =
          typeof uploadedTabularContext === 'string' && uploadedTabularContext.trim().length > 0
              ? uploadedTabularContext.trim()
              : null;

      /** Merged question for RAG + LLM (Slack sends everything in `question`; web client can split). */
      let question = uploadCtx
          ? `${baseQuestion || 'Analyze the uploaded spreadsheet and answer based on this file.'}\n\n${uploadCtx}`
          : baseQuestion;

      /** Legacy / Slack: full blob only in `question`. */
      if (!uploadCtx && baseQuestion.includes('--- Uploaded Tabular Data Context ---')) {
          question = baseQuestion;
      }

      if (
          !uploadCtx &&
          !baseQuestion.includes('--- Uploaded Tabular Data Context ---') &&
          questionReferencesUploadWithoutContext(baseQuestion)
      ) {
          console.warn(
              '[chat] Blocking: question references an upload but no tabular context — attach a .csv/.xlsx and click Send.'
          );
          return res.status(400).json({
              error: 'No file data in this request',
              message:
                  'Your question refers to an uploaded file, but this request did not include spreadsheet data. Attach a .csv, .xlsx, or .xls (📎), wait for “Ready to send”, then Send. For follow-ups in the same chat, re-attach the file if you switched threads or started a new chat.',
              suggestion:
                  'If you only want to query your warehouse (no file), rephrase without “the uploaded file”.',
          });
      }

      /** Short label for chat history — user question only; never the uploaded tabular blob (Slack sends both in `question`). */
      const chatHistoryQuestion = buildChatHistoryQuestionLabel(baseQuestion, uploadCtx, question);
      
      // Use userId from body (for Slack/internal calls) or from auth token (for frontend)
      const userId = bodyUserId || req.userId;
      
      // Check query limit before processing (if user is authenticated)
      let currentMonthCountForNotify = 0;
      let queryLimitForNotify: { limit: number } | null = null;
      if (userId) {
          try {
              const currentMonthCount = await usageTrackingService.getCurrentMonthQueryCount(userId);
              const queryLimit = await subscriptionService.checkQueryLimit(userId, currentMonthCount);
              currentMonthCountForNotify = currentMonthCount;
              queryLimitForNotify = queryLimit;

              if (!queryLimit.allowed) {
                  // Notify at 100% (fire-and-forget) before returning 403
                  (async () => {
                      try {
                          const subscription = await subscriptionService.getSubscription(userId);
                          const periodStart = subscription && (subscription.status === 'active' || subscription.status === 'trialing')
                              ? new Date(subscription.currentPeriodStart)
                              : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                          const already = await notificationService.hasNotificationSince(userId, 'usage_100', periodStart);
                          if (!already) {
                              const title = 'Query limit reached (100%)';
                              const message = `You have reached your monthly query limit (${currentMonthCount} of ${queryLimit.limit}). Please upgrade your plan to continue.`;
                              const notif = await notificationService.createNotification({ userId, type: 'usage_100', title, message });
                              const user = await userService.getUserById(userId);
                              if (user?.email) {
                                  try {
                                      const html = `<div style="font-family: Arial, sans-serif;"><h2>${title}</h2><p>${message}</p><p><a href="${process.env.FRONTEND_URL || 'https://app.aiquery.ai'}/app_admin">Upgrade in AIquery</a></p></div>`;
                                      await resendService.sendNotificationEmail(user.email, title + ' – AIquery', html);
                                      await notificationService.setEmailSent(notif.id);
                                  } catch (e) { console.warn('Notification email failed:', e); }
                              }
                          }
                      } catch (e) { console.warn('Usage 100% notification failed:', e); }
                  })();
                  return res.status(403).json({
                      error: 'Query limit exceeded',
                      message: `You have reached your monthly query limit of ${queryLimit.limit}. Please upgrade your plan to continue.`,
                      limit: queryLimit.limit,
                      current: currentMonthCount,
                      upgradeUrl: '/pricing'
                  });
              }
          } catch (error) {
              console.warn('Error checking query limit:', error);
              // Continue if limit check fails - don't block the request
          }
      }

      // Usage reminders at 75%, 90%, 100% (fire-and-forget, do not block response)
      if (userId && queryLimitForNotify && queryLimitForNotify.limit > 0) {
          const limit = queryLimitForNotify.limit;
          const current = currentMonthCountForNotify;
          (async () => {
              try {
                  const subscription = await subscriptionService.getSubscription(userId);
                  const periodStart = subscription && (subscription.status === 'active' || subscription.status === 'trialing')
                      ? new Date(subscription.currentPeriodStart)
                      : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
                  const thresholds: { pct: number; type: 'usage_75' | 'usage_90' | 'usage_100'; title: string }[] = [
                      { pct: 100, type: 'usage_100', title: 'Query limit reached (100%)' },
                      { pct: 90, type: 'usage_90', title: 'Query usage at 90%' },
                      { pct: 75, type: 'usage_75', title: 'Query usage at 75%' },
                  ];
                  for (const { pct, type, title } of thresholds) {
                      if (current < (limit * pct) / 100) continue;
                      const already = await notificationService.hasNotificationSince(userId, type, periodStart);
                      if (already) continue;
                      const message = `Your query usage is at ${pct}% of your plan limit (${current} of ${limit} queries this period).${pct === 100 ? ' Please upgrade your plan to continue.' : ' Consider upgrading if you need more.'}`;
                      const notif = await notificationService.createNotification({ userId, type, title, message });
                      const user = await userService.getUserById(userId);
                      if (user?.email) {
                          try {
                              const html = `<div style="font-family: Arial, sans-serif;"><h2>${title}</h2><p>${message.replace(/\n/g, '<br>')}</p><p><a href="${process.env.FRONTEND_URL || 'https://app.aiquery.ai'}/app_admin">View in AIquery</a></p></div>`;
                              await resendService.sendNotificationEmail(user.email, title + ' – AIquery', html);
                              await notificationService.setEmailSent(notif.id);
                          } catch (e) {
                              console.warn('Notification email failed:', e);
                          }
                      }
                  }
              } catch (e) {
                  console.warn('Usage notification check failed:', e);
              }
          })();
      }
      
      // If connectionConfig is not provided and user is authenticated, fetch from database
      if (!connectionConfig && userId) {
          try {
              const configs = await connectionConfigService.getConnectionConfigs(userId);
              // Find first connected data source (prioritize BigQuery, then Airtable, then others)
              const connectedConfigs = configs.filter(c => c.connectionStatus === 'connected');
              
              console.log(`[Chat API] Found ${connectedConfigs.length} connected configs for user ${userId}:`, 
                  connectedConfigs.map(c => ({ sourceType: c.sourceType, sourceId: c.sourceId })));
              
              if (connectedConfigs.length > 0) {
                  // Try to find BigQuery first
                  let selectedConfig = connectedConfigs.find(c => c.sourceType === 'bigquery' && c.sourceId === 'bigquery');
                  
                  // If no BigQuery, try Airtable
                  if (!selectedConfig) {
                      selectedConfig = connectedConfigs.find(c => c.sourceType === 'airtable' && c.sourceId === 'airtable');
                  }
                  
                  // If no BigQuery or Airtable, try Databricks
                  if (!selectedConfig) {
                      selectedConfig = connectedConfigs.find(c => c.sourceType === 'databricks' && c.sourceId === 'databricks');
                  }
                  
                  // If still no match, use the first connected config
                  if (!selectedConfig) {
                      selectedConfig = connectedConfigs[0];
                  }
                  
                  console.log(`[Chat API] Selected config:`, { 
                      sourceType: selectedConfig?.sourceType, 
                      sourceId: selectedConfig?.sourceId 
                  });
                  
                  if (selectedConfig && selectedConfig.config) {
                      // Build connectionConfig based on source type
                      if (selectedConfig.sourceType === 'airtable') {
                          connectionConfig = {
                              airtable: {
                                  apiKey: selectedConfig.config.apiKey,
                                  baseId: selectedConfig.config.baseId,
                                  tables: selectedConfig.config.tables
                              }
                          };
                          console.log(`Loaded Airtable connection config from database for user ${userId}`);
                      } else if (selectedConfig.sourceType === 'bigquery') {
                          connectionConfig = {
                              bigquery: {
                                  projectId: selectedConfig.config.projectId,
                                  serviceAccountKey: selectedConfig.config.serviceAccountKey,
                                  datasets: selectedConfig.config.datasets
                              }
                          };
                          console.log(`Loaded BigQuery connection config from database for user ${userId}`);
                      } else if (selectedConfig.sourceType === 'databricks') {
                          connectionConfig = {
                              databricks: {
                                  host: selectedConfig.config.host,
                                  server: selectedConfig.config.server,
                                  serverHostname: selectedConfig.config.serverHostname,
                                  port: selectedConfig.config.port,
                                  database: selectedConfig.config.database,
                                  schema: selectedConfig.config.schema,
                                  httpPath: selectedConfig.config.httpPath,
                                  accessToken: selectedConfig.config.accessToken,
                                  token: selectedConfig.config.token,
                                  connectionMethod: selectedConfig.config.connectionMethod,
                                  jdbcUrl: selectedConfig.config.jdbcUrl,
                                  tokenName: selectedConfig.config.tokenName,
                                  clientId: selectedConfig.config.clientId,
                                  clientSecret: selectedConfig.config.clientSecret
                              }
                          };
                          console.log(`Loaded Databricks connection config from database for user ${userId}`);
                      } else if (selectedConfig.sourceType === 'postgres' || selectedConfig.sourceType === 'postgresql') {
                          connectionConfig = {
                              postgres: {
                                  host: selectedConfig.config.host || selectedConfig.config.server,
                                  server: selectedConfig.config.server,
                                  port: selectedConfig.config.port,
                                  database: selectedConfig.config.database,
                                  username: selectedConfig.config.username,
                                  password: selectedConfig.config.password,
                                  schema: selectedConfig.config.schema,
                                  httpPath: selectedConfig.config.httpPath,
                                  accessToken: selectedConfig.config.accessToken
                              }
                          };
                          console.log(`Loaded PostgreSQL connection config from database for user ${userId}`);
                      } else if (selectedConfig.sourceType === 'redshift') {
                          connectionConfig = {
                              redshift: {
                                  host: selectedConfig.config.host || selectedConfig.config.server,
                                  server: selectedConfig.config.server,
                                  port: selectedConfig.config.port,
                                  database: selectedConfig.config.database,
                                  username: selectedConfig.config.username,
                                  password: selectedConfig.config.password,
                                  schema: selectedConfig.config.schema,
                                  httpPath: selectedConfig.config.httpPath,
                                  accessToken: selectedConfig.config.accessToken
                              }
                          };
                          console.log(`Loaded Redshift connection config from database for user ${userId}`);
                      } else if (selectedConfig.sourceType === 'azure' || selectedConfig.sourceType === 'sqlserver') {
                          connectionConfig = {
                              azure: {
                                  host: selectedConfig.config.host || selectedConfig.config.server,
                                  server: selectedConfig.config.server,
                                  port: selectedConfig.config.port,
                                  database: selectedConfig.config.database,
                                  username: selectedConfig.config.username,
                                  password: selectedConfig.config.password,
                                  schema: selectedConfig.config.schema,
                                  httpPath: selectedConfig.config.httpPath,
                                  accessToken: selectedConfig.config.accessToken
                              }
                          };
                          console.log(`Loaded Azure SQL Server connection config from database for user ${userId}`);
                      } else if (selectedConfig.sourceType === 'snowflake') {
                          connectionConfig = {
                              snowflake: {
                                  host: selectedConfig.config.host || selectedConfig.config.server,
                                  server: selectedConfig.config.server,
                                  port: selectedConfig.config.port,
                                  database: selectedConfig.config.database,
                                  username: selectedConfig.config.username,
                                  password: selectedConfig.config.password,
                                  schema: selectedConfig.config.schema,
                                  account: selectedConfig.config.account,
                                  warehouse: selectedConfig.config.warehouse,
                                  httpPath: selectedConfig.config.httpPath,
                                  accessToken: selectedConfig.config.accessToken
                              }
                          };
                          console.log(`Loaded Snowflake connection config from database for user ${userId}`);
                      } else if (selectedConfig.sourceType === 'mysql') {
                          connectionConfig = {
                              mysql: {
                                  host: selectedConfig.config.host || selectedConfig.config.server,
                                  server: selectedConfig.config.server,
                                  port: selectedConfig.config.port,
                                  database: selectedConfig.config.database,
                                  username: selectedConfig.config.username,
                                  password: selectedConfig.config.password,
                                  schema: selectedConfig.config.schema,
                                  httpPath: selectedConfig.config.httpPath,
                                  accessToken: selectedConfig.config.accessToken
                              }
                          };
                          console.log(`Loaded MySQL connection config from database for user ${userId}`);
                      }
                  }
              }
          } catch (dbError) {
              console.warn('Could not fetch connection config from database:', dbError);
              // Continue without connection config - will use defaults or fail gracefully
          }
      }
      
      const preferredProvider = parseLLMProviderString(
        typeof llmProvider === 'string' ? llmProvider : undefined
      );
      const requestApiKey =
          typeof llmApiKey === 'string' && llmApiKey.trim().length > 0 ? llmApiKey.trim() : '';
      const requestModel =
          typeof requestLlmModelRaw === 'string' && requestLlmModelRaw.trim().length > 0
              ? requestLlmModelRaw.trim()
              : undefined;

      // Request-provided key/model (from authenticated user's saved browser settings) takes precedence.
      // This prevents env fallback when UI has a user key but backend row is stale/missing.
      const llmConfig: LLMConfig | null =
          preferredProvider && requestApiKey
              ? {
                    provider: preferredProvider,
                    apiKey: requestApiKey,
                    model: requestModel,
                    useLightModel: Boolean(useLightModel),
                }
              : await getLLMConfig(userId, preferredProvider);

      if (preferredProvider && requestApiKey) {
          console.log(
              `[LLM Config] source=request userId=${userId ?? 'anon'} provider=${preferredProvider} model=${requestModel || 'default'}`
          );
      }
      
      if (!llmConfig) {
          return res.status(400).json({ 
              error: 'LLM API key is required. Configure LLM settings or set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY.' 
          });
      }
      
      // Set provider and API key from config
      llmProvider = llmConfig.provider;
      llm.setProvider(llmProvider);
      const apiKey = llmConfig.apiKey;
      useLightModel = llmConfig.useLightModel;
      const llmModel = llmConfig.model; // For Gemini: model name from env (GEMINI_MODEL)

      if (!question) {
          return res.status(400).json({ error: 'Question is required' });
      }

      console.log(
          `Processing question from ${userName || 'User'}: ${baseQuestion || '(no short text)'} [mergedLen=${question.length}, hasUpload=${!!uploadCtx}]`
      );

      // Check if this is a greeting or conversational message (not a data query)
      const questionLower = question.toLowerCase().trim();
      const greetingPrefixMatch = questionLower.match(
          /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy|sup|what's up)\b[\s,!.]*/i
      );
      const remainderAfterGreetingPrefix = greetingPrefixMatch
          ? questionLower.slice(greetingPrefixMatch[0].length).trim()
          : questionLower;
      const hasLikelyFollowUpQuestion =
          !!greetingPrefixMatch &&
          remainderAfterGreetingPrefix.length > 0 &&
          (remainderAfterGreetingPrefix.includes('?') || remainderAfterGreetingPrefix.split(/\s+/).length >= 3);
      const conversationalOnlyPatterns = [
          /^(hi|hello|hey|greetings|good morning|good afternoon|good evening|howdy|sup|what's up)(\s+[a-z0-9_-]+)?[\s,!.?]*$/i,
          /^(how are you|how's it going|how do you do)[\s,!.?]*$/i,
          /^(thanks|thank you|thx|appreciate it)[\s,!.?]*$/i,
          /^(bye|goodbye|see you|farewell)[\s,!.?]*$/i
      ];
      
      const isGreeting = !hasLikelyFollowUpQuestion && conversationalOnlyPatterns.some(pattern => pattern.test(questionLower));
      const isVeryShort = questionLower.length < 10 && !questionLower.includes('?');
      
      if (isGreeting || (isVeryShort && !questionLower.includes('show') && !questionLower.includes('what') && !questionLower.includes('how many'))) {
          // Get current date and day of week
          const now = new Date();
          const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
          const dayOfWeek = daysOfWeek[now.getDay()];
          const dateOptions: Intl.DateTimeFormatOptions = { 
              year: 'numeric', 
              month: 'long', 
              day: 'numeric' 
          };
          const formattedDate = now.toLocaleDateString('en-US', dateOptions);
          
          // Determine time of day for appropriate greeting
          const hour = now.getHours();
          let timeGreeting = '';
          if (hour < 12) {
              timeGreeting = 'Good morning';
          } else if (hour < 17) {
              timeGreeting = 'Good afternoon';
          } else {
              timeGreeting = 'Good evening';
          }
          
          // Check if request is from Slack/Teams (has bodyUserId but no auth token) or from frontend
          // Slack/Teams calls pass userId in body but don't have auth token
          // Frontend calls have auth token but don't pass userId in body
          const isFromSlackOrTeams = !!bodyUserId && !req.userId;
          const isFromFrontend = !!req.userId && !bodyUserId;
          
          // Get user's connected data sources to determine greeting
          let connectedDataSourceType: string | null = null;
          let hasAnyConnection = false;
          
          if (userId) {
              try {
                  const configs = await connectionConfigService.getConnectionConfigs(userId);
                  const connectedConfigs = configs.filter(c => c.connectionStatus === 'connected');
                  hasAnyConnection = connectedConfigs.length > 0;
                  
                  if (hasAnyConnection) {
                      // Get the first connected data source
                      const firstConnected = connectedConfigs[0];
                      // Map source types to display names
                      const dataSourceNames: { [key: string]: string } = {
                          'bigquery': 'BigQuery',
                          'airtable': 'Airtable',
                          'redshift': 'AWS Redshift',
                          'sqlserver': 'Azure SQL',
                          'snowflake': 'Snowflake',
                          'mysql': 'MySQL',
                          'postgres': 'PostgreSQL',
                          'databricks': 'Databricks'
                      };
                      connectedDataSourceType = dataSourceNames[firstConnected.sourceType] || firstConnected.sourceType;
                  }
              } catch (error) {
                  console.warn('Could not fetch connection configs for greeting:', error);
              }
          }
          
          // Return a polite greeting response
          let greetingMessage = '';
          if (questionLower.includes('bye') || questionLower.includes('goodbye')) {
              greetingMessage = `Goodbye! It was a pleasure assisting you today. Please feel free to return anytime you need help querying your data. Have a wonderful ${dayOfWeek}!`;
          } else if (questionLower.includes('thank') || questionLower.includes('thanks')) {
              greetingMessage = `You're very welcome! It's my pleasure to assist you. I'm here to help you query your data anytime you need. Have a great ${dayOfWeek}!`;
          } else {
              // Get user name for personalized greeting
              let userDisplayName = userName || 'User';
              if (userId) {
                  try {
                      const user = await userService.getUserById(userId);
                      if (user?.name) {
                          userDisplayName = user.name;
                      } else if (user?.email) {
                          userDisplayName = user.email.split('@')[0]; // Use email prefix as name
                      }
                  } catch (error) {
                      // Use provided userName if user lookup fails
                  }
              }
              
              // Case 1: Frontend UI - First time user (no connections)
              if (isFromFrontend && !hasAnyConnection) {
                  greetingMessage = `Hello, ${userDisplayName}, thank you very much for using Kira! Today is ${formattedDate}.\n\nPlease connect your "Data Sources" before you request data.`;
              } 
              // Case 2 & 3: Frontend UI with connections OR Slack/Teams (should have connections)
              else {
                  const dataSourceText = connectedDataSourceType || 'data source';
                  greetingMessage = `${timeGreeting}! I hope you're having a wonderful ${dayOfWeek}, ${formattedDate}.\n\nI'm Kira, your dedicated data query assistant. I'm here to help you explore and analyze your ${dataSourceText} data using natural language. I'd be delighted to assist you with any questions you might have.\n\nFor example, you could ask me:\n• "What was the revenue last month?"\n• "Show me the cost by channel"\n• "How many leads did we get yesterday?"\n\nHow may I assist you with your data today?`;
              }
          }
          
          return res.json({
              interpretation: greetingMessage,
              sqlQuery: undefined,
              queryResults: undefined
          });
      }

      // Check if user has data source connection but no LLM configuration
      if (userId) {
          try {
              // Check if user has any connected data sources
              const configs = await connectionConfigService.getConnectionConfigs(userId);
              const connectedConfigs = configs.filter(c => c.connectionStatus === 'connected');
              const hasDataSourceConnection = connectedConfigs.length > 0 || !!connectionConfig;
              
              // Check if user has LLM configuration
              const llmConfigCheck = await getLLMConfig(userId);
              const hasLLMConfig = !!llmConfigCheck;
              
              // If user has data source connection but no LLM configuration, return error message
              if (hasDataSourceConnection && !hasLLMConfig) {
                  return res.json({
                      interpretation: 'Please configure your LLM Configuration before requesting data. You can configure it in the "LLM Configuration" section.',
                      sqlQuery: undefined,
                      queryResults: undefined
                  });
              }
          } catch (error) {
              console.warn('Could not check connection and LLM configuration:', error);
              // Continue with the request - let it fail naturally if needed
          }
      }

      // Determine data source type from connection config first (needed for RAG check)
      let dataSourceTypeForRAG: DataSourceType | null = null;
      let identifierForRAG: string | null = null;
      let dataSourceNameForRAG = '';
      
      if (connectionConfig) {
          if (connectionConfig.airtable?.baseId) {
              dataSourceTypeForRAG = 'airtable';
              identifierForRAG = connectionConfig.airtable.baseId;
              dataSourceNameForRAG = 'Airtable';
          } else if (connectionConfig.bigquery?.projectId) {
              dataSourceTypeForRAG = 'bigquery';
              identifierForRAG = connectionConfig.bigquery.projectId;
              dataSourceNameForRAG = 'BigQuery';
          } else if (connectionConfig.databricks?.database) {
              dataSourceTypeForRAG = 'databricks';
              identifierForRAG = connectionConfig.databricks.database;
              dataSourceNameForRAG = 'Databricks';
          } else if (connectionConfig.postgres?.database || connectionConfig.postgresql?.database) {
              dataSourceTypeForRAG = 'postgres';
              identifierForRAG = connectionConfig.postgres?.database || connectionConfig.postgresql?.database || '';
              dataSourceNameForRAG = 'PostgreSQL';
          } else if (connectionConfig.redshift?.database) {
              dataSourceTypeForRAG = 'redshift';
              identifierForRAG = connectionConfig.redshift.database;
              dataSourceNameForRAG = 'AWS Redshift';
          } else if (connectionConfig.azure?.database || connectionConfig.sqlserver?.database) {
              dataSourceTypeForRAG = 'azure';
              identifierForRAG = connectionConfig.azure?.database || connectionConfig.sqlserver?.database || '';
              dataSourceNameForRAG = 'Azure SQL';
          } else if (connectionConfig.snowflake?.database) {
              dataSourceTypeForRAG = 'snowflake';
              identifierForRAG = connectionConfig.snowflake.database;
              dataSourceNameForRAG = 'Snowflake';
          } else if (connectionConfig.mysql?.database) {
              dataSourceTypeForRAG = 'mysql';
              identifierForRAG = connectionConfig.mysql.database;
              dataSourceNameForRAG = 'MySQL';
          }
      } else if (userId) {
          // If no connectionConfig in request, try to get from database
          try {
              const configs = await connectionConfigService.getConnectionConfigs(userId);
              const connectedConfigs = configs.filter(c => c.connectionStatus === 'connected');
              
              if (connectedConfigs.length > 0) {
                  // Use the first connected config (prioritize BigQuery, then Airtable, then others)
                  let selectedConfig = connectedConfigs.find(c => c.sourceType === 'bigquery' && c.sourceId === 'bigquery');
                  if (!selectedConfig) {
                      selectedConfig = connectedConfigs.find(c => c.sourceType === 'airtable' && c.sourceId === 'airtable');
                  }
                  if (!selectedConfig) {
                      selectedConfig = connectedConfigs[0];
                  }
                  
                  if (selectedConfig) {
                      if (selectedConfig.sourceType === 'airtable' && selectedConfig.config?.baseId) {
                          dataSourceTypeForRAG = 'airtable';
                          identifierForRAG = selectedConfig.config.baseId;
                          dataSourceNameForRAG = 'Airtable';
                      } else if (selectedConfig.sourceType === 'bigquery' && selectedConfig.config?.projectId) {
                          dataSourceTypeForRAG = 'bigquery';
                          identifierForRAG = selectedConfig.config.projectId;
                          dataSourceNameForRAG = 'BigQuery';
                      } else if (selectedConfig.sourceType === 'databricks' && selectedConfig.config?.database) {
                          dataSourceTypeForRAG = 'databricks';
                          identifierForRAG = selectedConfig.config.database;
                          dataSourceNameForRAG = 'Databricks';
                      } else if ((selectedConfig.sourceType === 'postgres' || selectedConfig.sourceType === 'postgresql') && selectedConfig.config?.database) {
                          dataSourceTypeForRAG = 'postgres';
                          identifierForRAG = selectedConfig.config.database;
                          dataSourceNameForRAG = 'PostgreSQL';
                      } else if (selectedConfig.sourceType === 'redshift' && selectedConfig.config?.database) {
                          dataSourceTypeForRAG = 'redshift';
                          identifierForRAG = selectedConfig.config.database;
                          dataSourceNameForRAG = 'AWS Redshift';
                      } else if ((selectedConfig.sourceType === 'azure' || selectedConfig.sourceType === 'sqlserver') && selectedConfig.config?.database) {
                          dataSourceTypeForRAG = 'azure';
                          identifierForRAG = selectedConfig.config.database;
                          dataSourceNameForRAG = 'Azure SQL';
                      } else if (selectedConfig.sourceType === 'snowflake' && selectedConfig.config?.database) {
                          dataSourceTypeForRAG = 'snowflake';
                          identifierForRAG = selectedConfig.config.database;
                          dataSourceNameForRAG = 'Snowflake';
                      } else if (selectedConfig.sourceType === 'mysql' && selectedConfig.config?.database) {
                          dataSourceTypeForRAG = 'mysql';
                          identifierForRAG = selectedConfig.config.database;
                          dataSourceNameForRAG = 'MySQL';
                      }
                  }
              }
          } catch (error) {
              console.warn('Could not fetch connection config for RAG check:', error);
          }
      }

      // Check if user has connected data source but no Knowledge Base
      if (userId && identifierForRAG && typeof identifierForRAG === 'string') {
          try {
              // Fetch user info to get name for folder lookup
              const user = await userService.getUserById(userId);
              const userNameForRAG = user?.name || user?.email || userName || null;
              
              // Check if Knowledge Base exists for this data source
              const ragIndex = await getRAGIndex(identifierForRAG, userId, userNameForRAG);
              
              // If no Knowledge Base found, return polite reminder
              if (!ragIndex) {
                  const dataSourceText = dataSourceNameForRAG || 'data source';
                  return res.json({
                      interpretation: `Thank you for connecting your ${dataSourceText}! To enable more accurate and efficient data analysis, we recommend generating a Knowledge Base (Knowledge Base) for your data source. This will help me better understand your data structure and provide more precise answers to your questions.\n\nYou can generate a Knowledge Base by:\n1. Going to the "Data Sources" section in the sidebar\n2. Clicking on your connected ${dataSourceText}\n3. Selecting "Generate Knowledge Base" or "Manage Knowledge Base"\n\nWould you like to proceed with generating a Knowledge Base, or would you prefer to continue with your current query?`,
                      sqlQuery: undefined,
                      queryResults: undefined
                  });
              }
          } catch (error) {
              console.warn('Could not check Knowledge Base configuration:', error);
              // Continue with the request - let it fail naturally if needed
          }
      }

      // Determine data source type from connection config
      let dataSourceType: DataSourceType | undefined;
      let dataSourceConfig: DataSourceConfig | undefined;
      
      if (connectionConfig) {
          if (connectionConfig.airtable && connectionConfig.airtable.apiKey && connectionConfig.airtable.baseId) {
              dataSourceType = 'airtable';
              dataSourceConfig = {
                  type: 'airtable',
                  airtable: {
                      apiKey: connectionConfig.airtable.apiKey,
                      baseId: connectionConfig.airtable.baseId
                  }
              };
          } else if (connectionConfig.bigquery && connectionConfig.bigquery.projectId && connectionConfig.bigquery.serviceAccountKey) {
              dataSourceType = 'bigquery';
              dataSourceConfig = {
                  type: 'bigquery',
                  bigquery: {
                      projectId: connectionConfig.bigquery.projectId,
                      serviceAccountKey: connectionConfig.bigquery.serviceAccountKey
                  }
              };
          } else if (connectionConfig.databricks) {
              // Check if Databricks config has required fields based on connection method
              const connMethod = connectionConfig.databricks.connectionMethod || (connectionConfig.databricks.jdbcUrl ? 'url' : 'host');
              const hasRequiredFields = connMethod === 'url' 
                  ? !!(connectionConfig.databricks.jdbcUrl && connectionConfig.databricks.tokenName && (connectionConfig.databricks.token || connectionConfig.databricks.accessToken))
                  : !!(connectionConfig.databricks.database && connectionConfig.databricks.clientId && connectionConfig.databricks.clientSecret);
              
              if (hasRequiredFields) {
                  dataSourceType = 'databricks';
                  console.log('[Chat API] Building Databricks dataSourceConfig with fields:', {
                      connectionMethod: connMethod,
                      hasJdbcUrl: !!connectionConfig.databricks.jdbcUrl,
                      hasConnectionMethod: !!connectionConfig.databricks.connectionMethod,
                      hasToken: !!(connectionConfig.databricks.token || connectionConfig.databricks.accessToken),
                      hasHttpPath: !!connectionConfig.databricks.httpPath,
                      hasServerHostname: !!connectionConfig.databricks.serverHostname,
                      hasDatabase: !!connectionConfig.databricks.database,
                      hasClientId: !!connectionConfig.databricks.clientId,
                      hasClientSecret: !!connectionConfig.databricks.clientSecret
                  });
                  dataSourceConfig = {
                      type: 'databricks',
                      databricks: connectionConfig.databricks
                  };
              } else {
                  console.error('[Chat API] Databricks config missing required fields:', {
                      connectionMethod: connMethod,
                      hasJdbcUrl: !!connectionConfig.databricks.jdbcUrl,
                      hasTokenName: !!connectionConfig.databricks.tokenName,
                      hasToken: !!(connectionConfig.databricks.token || connectionConfig.databricks.accessToken),
                      hasDatabase: !!connectionConfig.databricks.database,
                      hasClientId: !!connectionConfig.databricks.clientId,
                      hasClientSecret: !!connectionConfig.databricks.clientSecret
                  });
              }
          } else if ((connectionConfig.postgres && connectionConfig.postgres.database) || (connectionConfig.postgresql && connectionConfig.postgresql.database)) {
              dataSourceType = 'postgres';
              const postgresConfig = connectionConfig.postgres || connectionConfig.postgresql;
              dataSourceConfig = {
                  type: 'postgres',
                  postgres: postgresConfig!
              };
          } else if (connectionConfig.redshift && connectionConfig.redshift.database) {
              dataSourceType = 'redshift';
              dataSourceConfig = {
                  type: 'redshift',
                  redshift: connectionConfig.redshift
              };
          } else if ((connectionConfig.azure && connectionConfig.azure.database) || (connectionConfig.sqlserver && connectionConfig.sqlserver.database)) {
              dataSourceType = 'azure';
              const azureConfig = connectionConfig.azure || connectionConfig.sqlserver;
              dataSourceConfig = {
                  type: 'azure',
                  azure: azureConfig!
              };
          } else if (connectionConfig.snowflake && connectionConfig.snowflake.database) {
              dataSourceType = 'snowflake';
              // For Snowflake, ensure account is set (map from host if account is not present)
              if (!connectionConfig.snowflake.account && connectionConfig.snowflake.host) {
                  connectionConfig.snowflake.account = connectionConfig.snowflake.host;
              }
              // Ensure all required Snowflake fields are present
              if (!connectionConfig.snowflake.account || !connectionConfig.snowflake.warehouse || !connectionConfig.snowflake.database || !connectionConfig.snowflake.username || !connectionConfig.snowflake.password) {
                  console.error('[Chat API] Snowflake config missing required fields:', {
                      hasAccount: !!connectionConfig.snowflake.account,
                      hasWarehouse: !!connectionConfig.snowflake.warehouse,
                      hasDatabase: !!connectionConfig.snowflake.database,
                      hasUsername: !!connectionConfig.snowflake.username,
                      hasPassword: !!connectionConfig.snowflake.password
                  });
              }
              dataSourceConfig = {
                  type: 'snowflake',
                  snowflake: connectionConfig.snowflake
              };
          } else if (connectionConfig.mysql && connectionConfig.mysql.database) {
              dataSourceType = 'mysql';
              dataSourceConfig = {
                  type: 'mysql',
                  mysql: connectionConfig.mysql
              };
          }
          
          // No valid connection config found
          if (!dataSourceType || !dataSourceConfig) {
              return res.json({
                  interpretation: 'No valid data source connection found. Please configure a data source connection in the "Data Sources" section before requesting data.',
                  sqlQuery: undefined,
                  queryResults: undefined
              });
          }
      } else {
          // No connection config at all
          return res.json({
              interpretation: 'No data source connection found. Please configure a data source connection in the "Data Sources" section before requesting data.',
              sqlQuery: undefined,
              queryResults: undefined
          });
      }

      // Step 1: Convert natural language to query (SQL for BigQuery, Airtable query format for Airtable)
      let generatedQuery: string;
      /**
       * Single Knowledge Base retrieval per question (shared by SQL LLM + interpretation LLM).
       * Two LLM calls are still required (SQL, then insights with row data); RAG is not retrieved twice.
       */
      let ragContext: string | null = null;
      const ragChatTopK = Math.min(
          20,
          Math.max(1, parseInt(String(process.env.RAG_CHAT_TOP_K || '5'), 10) || 5)
      );
      let ragRetrievalMeta: { indexId: string; dataSourceLabel: string } | null = null;
      try {
          let airtableConfig: any = {};
          let bigqueryConfig: any = {};
          let sqlConfig: any = {};
          
          if (dataSourceType === 'bigquery' && connectionConfig?.bigquery) {
              bigqueryConfig = {
                  datasets: connectionConfig.bigquery.datasets,
                  projectId: connectionConfig.bigquery.projectId
              };
          } else if (dataSourceType === 'bigquery') {
              // Initialize empty config for BigQuery even if connectionConfig is missing
              bigqueryConfig = {};
          }
          
          if (dataSourceType === 'airtable' && dataSourceConfig.airtable) {
              airtableConfig = { 
                  baseId: dataSourceConfig.airtable.baseId,
                  tableName: connectionConfig?.airtable?.tables ? connectionConfig.airtable.tables.split(',')[0].trim() : undefined,
                  availableTables: connectionConfig?.airtable?.tables
              };
              
              // Try to extract table name from question or available tables to fetch schema
              let tableToFetchSchema: string | undefined;
              if (airtableConfig.availableTables) {
                  const tables = airtableConfig.availableTables.split(',').map((t: string) => t.trim());
                  // Try to match table name from question
                  const questionLower = question.toLowerCase();
                  for (const table of tables) {
                      if (questionLower.includes(table.toLowerCase())) {
                          tableToFetchSchema = table;
                          break;
                      }
                  }
                  // If no match, use first table as fallback
                  if (!tableToFetchSchema && tables.length > 0) {
                      tableToFetchSchema = tables[0];
                  }
              }
              
              // Fetch schema for the table if we can determine it
              if (tableToFetchSchema && dataSourceConfig.airtable) {
                  try {
                      const airtableClient = createAirtableClient(dataSourceConfig.airtable);
                      const schema = await airtableClient.getTableSchema(tableToFetchSchema);
                      if (schema && schema.fields && schema.fields.length > 0) {
                          airtableConfig.tableFields = schema.fields;
                          airtableConfig.tableName = tableToFetchSchema;
                          console.log(`Fetched schema for table "${tableToFetchSchema}": ${schema.fields.length} fields`);
                      }
                  } catch (schemaError) {
                      console.warn(`Could not fetch schema for table "${tableToFetchSchema}":`, schemaError);
                      // Continue without schema - LLM will have to guess or omit fields
                  }
              }
          } else if (dataSourceType === 'airtable') {
              // Initialize empty config for Airtable even if connectionConfig is missing
              airtableConfig = {};
          }
          
          // Handle SQL databases
          if (dataSourceType === 'databricks') {
              const sqlConnection = connectionConfig?.databricks || connectionConfig;
              sqlConfig = {
                  database: sqlConnection?.database,
                  schema: sqlConnection?.schema,
                  schemas: sqlConnection?.schemas
              };
              // For Databricks, database might not be set for URL connections
              // Use it from connectionConfig.databricks if available
              if (!sqlConfig.database && connectionConfig?.databricks?.database) {
                  sqlConfig.database = connectionConfig.databricks.database;
              }
          } else if (dataSourceType === 'postgres') {
              const sqlConnection = connectionConfig?.postgres || connectionConfig?.postgresql || connectionConfig;
              sqlConfig = {
                  database: sqlConnection?.database,
                  schema: sqlConnection?.schema,
                  schemas: sqlConnection?.schemas
              };
          } else if (dataSourceType === 'redshift') {
              const sqlConnection = connectionConfig?.redshift || connectionConfig;
              sqlConfig = {
                  database: sqlConnection?.database,
                  schema: sqlConnection?.schema,
                  schemas: sqlConnection?.schemas
              };
          } else if (dataSourceType === 'azure') {
              const sqlConnection = connectionConfig?.azure || connectionConfig?.sqlserver || connectionConfig;
              sqlConfig = {
                  database: sqlConnection?.database,
                  schema: sqlConnection?.schema,
                  schemas: sqlConnection?.schemas
              };
          } else if (dataSourceType === 'snowflake') {
              const sqlConnection = connectionConfig?.snowflake || connectionConfig;
              sqlConfig = {
                  database: sqlConnection?.database,
                  schema: sqlConnection?.schema,
                  schemas: sqlConnection?.schemas
              };
          } else if (dataSourceType === 'mysql') {
              const sqlConnection = connectionConfig?.mysql || connectionConfig;
              sqlConfig = {
                  database: sqlConnection?.database,
                  schema: sqlConnection?.schema,
                  schemas: sqlConnection?.schemas
              };
          }
          
          console.log(
              `Generating ${dataSourceType} query (mergedLen=${question.length}, hasUpload=${!!uploadCtx}): "${baseQuestion.slice(0, 200)}${baseQuestion.length > 200 ? '…' : ''}"`
          );
          
          // Check if Knowledge Base exists and use it for BigQuery
          if (userId) {
              // Fetch user info to get name for folder lookup
              const user = await userService.getUserById(userId);
              const userNameForRAG = user?.name || user?.email || userName || null;
              
              if (dataSourceType === 'bigquery' && connectionConfig?.bigquery?.projectId) {
                  const ragIndex = await getRAGIndex(connectionConfig.bigquery.projectId, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          ragContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          ragRetrievalMeta = { indexId: ragIndex.id, dataSourceLabel: 'BigQuery' };
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context, falling back to hardcoded prompts:', ragError);
                      }
                  } else {
                      console.log(`ℹ️ No Knowledge Base found for BigQuery project ${connectionConfig.bigquery.projectId} and user ${userId}`);
                  }
              } else if (dataSourceType === 'airtable' && connectionConfig?.airtable?.baseId) {
                  const ragIndex = await getRAGIndex(connectionConfig.airtable.baseId, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          ragContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          ragRetrievalMeta = { indexId: ragIndex.id, dataSourceLabel: 'Airtable' };
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context, falling back to hardcoded prompts:', ragError);
                      }
                  } else {
                      console.log(`ℹ️ No Knowledge Base found for Airtable base ${connectionConfig.airtable.baseId} and user ${userId}`);
                  }
              } else if (dataSourceType === 'databricks') {
                  // For Databricks, try to get database identifier from multiple possible locations
                  // When creating RAG, database is at top level: connectionConfig.database
                  // When querying, it might be at: connectionConfig.databricks.database or connectionConfig.database
                  // For URL connection method, database might be in the JDBC URL
                  let databaseIdentifier = connectionConfig?.databricks?.database 
                      || connectionConfig?.database 
                      || sqlConfig?.database;
                  
                  // If database is not set but we have a JDBC URL, extract it from the URL
                  if (!databaseIdentifier && connectionConfig?.databricks?.jdbcUrl) {
                      try {
                          // Extract database from JDBC URL: jdbc:databricks://server:port/database;params...
                          const jdbcUrl = connectionConfig.databricks.jdbcUrl;
                          const match = jdbcUrl.match(/jdbc:databricks:\/\/([^:]+):(\d+)\/([^;]+)/);
                          if (match && match[3]) {
                              databaseIdentifier = match[3];
                              console.log(`📦 Extracted database "${databaseIdentifier}" from JDBC URL for RAG lookup`);
                          }
                      } catch (err) {
                          console.warn('⚠️ Could not extract database from JDBC URL:', err);
                      }
                  }
                  
                  if (databaseIdentifier) {
                      console.log(`🔍 Looking for Databricks Knowledge Base with identifier: "${databaseIdentifier}" for user ${userId}`);
                      const ragIndex = await getRAGIndex(databaseIdentifier, userId, userNameForRAG);
                      if (ragIndex) {
                          try {
                              ragContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                              ragRetrievalMeta = { indexId: ragIndex.id, dataSourceLabel: 'Databricks' };
                              if (process.env.LOG_CHAT_DEBUG === '1') {
                                  console.log(`📋 RAG preview (first 500 chars): ${ragContext?.substring(0, 500)}...`);
                                  const tableNameMatches = ragContext?.match(/Table:\s*([^\n]+)/g);
                                  if (tableNameMatches?.length) {
                                      console.log(`📊 Tables in RAG context: ${tableNameMatches.map(m => m.replace('Table:', '').trim()).join(', ')}`);
                                  }
                              }
                          } catch (ragError) {
                              console.warn('⚠️ Error retrieving RAG context, falling back to hardcoded prompts:', ragError);
                          }
                      } else {
                          console.log(`ℹ️ No Knowledge Base found for Databricks database "${databaseIdentifier}" and user ${userId}`);
                          // Fallback for single-file-per-source KB strategy:
                          // if database identifier does not match, use latest Databricks KB for this user.
                          try {
                              const allIndexes = (await getAllRAGIndexes(userId, userNameForRAG)) as Array<Record<string, unknown>>;
                              const latestDatabricks = allIndexes
                                  .filter((idx) => String(idx.dataSourceType || '').toLowerCase() === 'databricks')
                                  .sort((a, b) => {
                                      const at = new Date(String(a.updatedAt || a.createdAt || 0)).getTime();
                                      const bt = new Date(String(b.updatedAt || b.createdAt || 0)).getTime();
                                      return bt - at;
                                  })[0];
                              if (latestDatabricks?.id) {
                                  const fallbackId = String(latestDatabricks.id);
                                  ragContext = await retrieveRAGContext(question, fallbackId, userId, ragChatTopK, userNameForRAG);
                                  ragRetrievalMeta = { indexId: fallbackId, dataSourceLabel: 'Databricks' };
                                  console.log(`✅ Using latest Databricks Knowledge Base fallback: ${fallbackId}`);
                              }
                          } catch (fallbackErr) {
                              console.warn('⚠️ Databricks KB fallback lookup failed:', fallbackErr);
                          }
                          console.log(`💡 Available connection config keys:`, Object.keys(connectionConfig || {}));
                          if (connectionConfig?.databricks) {
                              console.log(`💡 Databricks config keys:`, Object.keys(connectionConfig.databricks));
                          }
                      }
                  } else {
                      console.warn('⚠️ No database identifier found for Databricks RAG lookup. Connection config:', {
                          hasDatabricksConfig: !!connectionConfig?.databricks,
                          hasDatabricksDatabase: !!connectionConfig?.databricks?.database,
                          hasTopLevelDatabase: !!connectionConfig?.database,
                          hasJdbcUrl: !!connectionConfig?.databricks?.jdbcUrl,
                          hasSqlConfig: !!sqlConfig,
                          sqlConfigDatabase: sqlConfig?.database,
                          connectionConfigKeys: Object.keys(connectionConfig || {})
                      });
                  }
              } else if (dataSourceType === 'postgres' && sqlConfig?.database) {
                  const ragIndex = await getRAGIndex(sqlConfig.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          ragContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          ragRetrievalMeta = { indexId: ragIndex.id, dataSourceLabel: 'PostgreSQL' };
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context, falling back to hardcoded prompts:', ragError);
                      }
                  } else {
                      console.log(`ℹ️ No Knowledge Base found for PostgreSQL database ${sqlConfig.database} and user ${userId}`);
                  }
              } else if (dataSourceType === 'redshift' && sqlConfig?.database) {
                  const ragIndex = await getRAGIndex(sqlConfig.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          ragContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          ragRetrievalMeta = { indexId: ragIndex.id, dataSourceLabel: 'Redshift' };
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context, falling back to hardcoded prompts:', ragError);
                      }
                  } else {
                      console.log(`ℹ️ No Knowledge Base found for Redshift database ${sqlConfig.database} and user ${userId}`);
                  }
              } else if (dataSourceType === 'azure' && sqlConfig?.database) {
                  const ragIndex = await getRAGIndex(sqlConfig.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          ragContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          ragRetrievalMeta = { indexId: ragIndex.id, dataSourceLabel: 'Azure SQL' };
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context, falling back to hardcoded prompts:', ragError);
                      }
                  } else {
                      console.log(`ℹ️ No Knowledge Base found for Azure SQL Server database ${sqlConfig.database} and user ${userId}`);
                  }
              } else if (dataSourceType === 'snowflake' && sqlConfig?.database) {
                  const ragIndex = await getRAGIndex(sqlConfig.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          ragContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          ragRetrievalMeta = { indexId: ragIndex.id, dataSourceLabel: 'Snowflake' };
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context, falling back to hardcoded prompts:', ragError);
                      }
                  } else {
                      console.log(`ℹ️ No Knowledge Base found for Snowflake database ${sqlConfig.database} and user ${userId}`);
                  }
              } else if (dataSourceType === 'mysql' && sqlConfig?.database) {
                  const ragIndex = await getRAGIndex(sqlConfig.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          ragContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          ragRetrievalMeta = { indexId: ragIndex.id, dataSourceLabel: 'MySQL' };
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context, falling back to hardcoded prompts:', ragError);
                      }
                  } else {
                      console.log(`ℹ️ No Knowledge Base found for MySQL database ${sqlConfig.database} and user ${userId}`);
                  }
              }
          }

          if (ragContext && ragContext.trim() && ragRetrievalMeta && userId) {
              console.log(
                  `✅ Knowledge Base context retrieved (topK=${ragChatTopK}, indexId=${ragRetrievalMeta.indexId}, userId=${userId}) — ` +
                      `${ragRetrievalMeta.dataSourceLabel}: SQL generation + structured interpretation (single retrieval)`
              );
          }
          
          // Determine which config to use based on data source type
          let llmConfig: any;
          if (dataSourceType === 'airtable') {
              llmConfig = airtableConfig;
          } else if (dataSourceType === 'bigquery') {
              llmConfig = bigqueryConfig;
          } else if (dataSourceType === 'databricks') {
              llmConfig = sqlConfig;
          } else if (dataSourceType === 'postgres') {
              llmConfig = sqlConfig;
          } else if (dataSourceType === 'redshift') {
              llmConfig = sqlConfig;
          } else if (dataSourceType === 'azure') {
              llmConfig = sqlConfig;
          } else if (dataSourceType === 'snowflake') {
              llmConfig = sqlConfig;
          } else if (dataSourceType === 'mysql') {
              llmConfig = sqlConfig;
          } else {
              // Fallback to BigQuery
              llmConfig = bigqueryConfig;
          }
          
          // Ensure llmConfig is always an object
          if (!llmConfig || typeof llmConfig !== 'object') {
              llmConfig = {};
          }
          
          // Pass RAG context if available
          if (ragContext) {
              llmConfig.ragContext = ragContext;
          }
          // Pass API key and model to LLM config
          if (apiKey) {
              llmConfig.apiKey = apiKey;
          }
          // Pass model name if available (for Gemini from GEMINI_MODEL env var)
          if (llmModel) {
              llmConfig.model = llmModel;
          }
          // Map data source types for LLM (LLM uses 'sqlserver' for Azure SQL and 'postgresql' for PostgreSQL)
          let llmDataSourceType: 'bigquery' | 'airtable' | 'redshift' | 'sqlserver' | 'snowflake' | 'mysql' | 'postgresql' | 'databricks' = dataSourceType as any;
          if (dataSourceType === 'azure') {
              llmDataSourceType = 'sqlserver';
          } else if (dataSourceType === 'postgres') {
              llmDataSourceType = 'postgresql';
          }
          
          generatedQuery = await llm.convertToSQL(question, llmDataSourceType, llmConfig);
          console.log(`Generated ${dataSourceType} query:`, generatedQuery);
          
          // Basic validation
          if (!generatedQuery || generatedQuery.trim().length === 0) {
              throw new Error(`Generated ${dataSourceType} query is empty`);
          }
          
          // For BigQuery, check if it looks like SQL
          if (dataSourceType === 'bigquery') {
              const upperQuery = generatedQuery.toUpperCase().trim();
              if (!upperQuery.startsWith('SELECT') && !upperQuery.startsWith('WITH')) {
                  throw new Error(`Invalid SQL query generated. Query must start with SELECT or WITH, but got: ${generatedQuery.substring(0, 100)}`);
              }
          }
      } catch (error) {
          console.error(`Error generating ${dataSourceType} query:`, error);
          const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          
          // Check if this is an LLM/OpenAI error
          if (errorMessage.includes('Invalid permissions') || errorMessage.includes('model was not found')) {
              return res.status(400).json({
                  error: 'LLM Service Error',
                  message: 'There was an issue with the AI service. Please check your OpenAI API key configuration.',
                  suggestion: 'Make sure your OPENAI_API_KEY environment variable is set correctly and has valid permissions.'
              });
          }
          
          return res.status(400).json({
              error: `Failed to generate ${dataSourceType} query`,
              message: errorMessage,
              suggestion: 'Please try rephrasing your question or be more specific about what data you need.'
          });
      }

      // Step 2: Validate query safety for all SQL data sources
      let isSafe = true;
      if (['bigquery', 'redshift', 'azure', 'sqlserver', 'snowflake', 'mysql', 'postgres', 'postgresql', 'databricks'].includes(dataSourceType)) {
          switch (dataSourceType as string) {
              case 'bigquery':
                  isSafe = isSafeToRunBigQuery(generatedQuery);
                  break;
              case 'redshift':
                  isSafe = isSafeToRunRedshift(generatedQuery);
                  break;
              case 'azure':
              case 'sqlserver':
                  isSafe = isSafeToRunSQLServer(generatedQuery);
                  break;
              case 'snowflake':
                  isSafe = isSafeToRunSnowflake(generatedQuery);
                  break;
              case 'mysql':
                  isSafe = isSafeToRunMySQL(generatedQuery);
                  break;
              case 'postgres':
              case 'postgresql':
                  isSafe = isSafeToRunPostgreSQL(generatedQuery);
                  break;
              case 'databricks':
                  isSafe = isSafeToRunDatabricks(generatedQuery);
                  break;
          }
          
          if (!isSafe) {
              console.error('Query safety check failed:', generatedQuery);
              return res.status(400).json({
                  error: 'Query validation failed',
                  message: 'The query contains forbidden operations (DELETE, DROP, TRUNCATE, ALTER, UPDATE, INSERT) or is too complex.',
                  sqlQuery: generatedQuery,
                  suggestion: 'Only SELECT queries are allowed. Please rephrase your question to query data only.'
              });
          }
      }
      
      console.log('Query validation passed. Executing query...');
      
      // Step 3: Execute query using QueryExecutor (which now uses validateAndExecuteSQL internally)
      let queryResults: any[];
      let finalQuery: string;
      try {
          queryResults = await QueryExecutor.executeQuery(generatedQuery, dataSourceConfig);
          
          // Get final executed query with automatic ordering applied
          switch (dataSourceType as string) {
              case 'bigquery':
                  finalQuery = getFinalExecutedBigQueryQuery(generatedQuery);
                  break;
              case 'redshift':
                  finalQuery = getFinalExecutedRedshiftQuery(generatedQuery);
                  break;
              case 'azure':
              case 'sqlserver':
                  finalQuery = getFinalExecutedSQLServerQuery(generatedQuery);
                  break;
              case 'snowflake':
                  finalQuery = getFinalExecutedSnowflakeQuery(generatedQuery);
                  break;
              case 'mysql':
                  finalQuery = getFinalExecutedMySQLQuery(generatedQuery);
                  break;
              case 'postgres':
              case 'postgresql':
                  finalQuery = getFinalExecutedPostgreSQLQuery(generatedQuery);
                  break;
              case 'databricks':
                  finalQuery = getFinalExecutedDatabricksQuery(generatedQuery);
                  break;
              default:
                  finalQuery = generatedQuery;
          }
      } catch (error) {
          console.error(`Error executing ${dataSourceType} query:`, error);
          return res.status(400).json({
              error: `Failed to execute ${dataSourceType} query`,
              message: error instanceof Error ? error.message : 'Unknown error occurred',
              sqlQuery: generatedQuery,
              suggestion: `The generated ${dataSourceType} query had an error. Please try rephrasing your question.`
          });
      }

      console.log(`Query returned ${queryResults.length} rows`);

      // Track query usage (non-blocking — do not add latency to the critical path)
      if (userId) {
          void usageTrackingService.incrementQueryCount(userId).catch((err) => {
              console.warn('Failed to track query usage:', err);
          });
      }

      // Step 4 & 5: Interpret results + optional chart in parallel (saves wall time vs sequential LLM calls)
      const chatAutoViz =
          process.env.CHAT_AUTO_VIZ !== '0' && String(process.env.CHAT_AUTO_VIZ).toLowerCase() !== 'false';
      /** Second LLM call: natural-language interpretation of rows. Set CHAT_LLM_INTERPRETATION=0 to skip (faster; short template only). */
      const chatLlmInterpretation =
          process.env.CHAT_LLM_INTERPRETATION !== '0' &&
          String(process.env.CHAT_LLM_INTERPRETATION ?? '1').toLowerCase() !== 'false';
      let interpretation: string;
      let imagePath: string | undefined;
      const buildDataDrivenFallbackInterpretation = (rows: any[], userQuestion: string): string => {
          if (!Array.isArray(rows) || rows.length === 0) {
              return 'No rows were returned for this query. Try broadening filters or checking whether the selected period has data.';
          }

          const keys = Object.keys(rows[0] || {});
          const numericKeys = keys.filter((k) => rows.some((r) => Number.isFinite(Number(r?.[k]))));
          const nonNumericKeys = keys.filter((k) => !numericKeys.includes(k));

          if (numericKeys.length >= 1 && nonNumericKeys.length >= 1) {
              const metric = numericKeys[0];
              const dimension = nonNumericKeys[0];
              const ranked = rows
                  .map((r) => ({
                      label: String(r?.[dimension] ?? 'Unknown'),
                      value: Number(r?.[metric]),
                  }))
                  .filter((x) => Number.isFinite(x.value))
                  .sort((a, b) => b.value - a.value);

              if (ranked.length > 0) {
                  const total = ranked.reduce((sum, x) => sum + x.value, 0);
                  const top1 = ranked[0];
                  const top2 = ranked[1];
                  const bottom = ranked[ranked.length - 1];
                  const topShare = total > 0 ? ((top1.value / total) * 100).toFixed(1) : '0.0';
                  const questionLine = userQuestion?.trim()
                      ? `For "${userQuestion.trim()}", the query returned ${ranked.length} grouped results.`
                      : `The query returned ${ranked.length} grouped results.`;
                  const secondLine = top2
                      ? `The top segment is ${top1.label} with ${top1.value.toLocaleString()} (${topShare}% of total), followed by ${top2.label} at ${top2.value.toLocaleString()}.`
                      : `The top segment is ${top1.label} with ${top1.value.toLocaleString()} (${topShare}% of total).`;
                  return `${questionLine} ${secondLine} In total there are ${total.toLocaleString()} ${metric} across all groups, and the lowest group is ${bottom.label} with ${bottom.value.toLocaleString()}.`;
              }
          }

          if (numericKeys.length > 0) {
              const metric = numericKeys[0];
              const vals = rows
                  .map((r) => Number(r?.[metric]))
                  .filter((v) => Number.isFinite(v));
              if (vals.length > 0) {
                  const sum = vals.reduce((a, b) => a + b, 0);
                  const avg = sum / vals.length;
                  const min = Math.min(...vals);
                  const max = Math.max(...vals);
                  return `The query returned ${rows.length} rows. For ${metric}, the average is ${avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}, ranging from ${min.toLocaleString()} to ${max.toLocaleString()}, with a total of ${sum.toLocaleString()}.`;
              }
          }

          return `The query returned ${rows.length} rows. I can see multiple records, but this result shape is mostly categorical text; add a numeric metric (count, amount, or score) to generate deeper quantitative insights.`;
      };
      try {
          let interpretationRagContext: string | null =
              ragContext && ragContext.trim().length > 0 ? ragContext : null;

          if (chatLlmInterpretation && !interpretationRagContext && userId) {
              const user = await userService.getUserById(userId);
              const userNameForRAG = user?.name || user?.email || userName || null;

              if (dataSourceType === 'airtable' && connectionConfig?.airtable?.baseId) {
                  const ragIndex = await getRAGIndex(connectionConfig.airtable.baseId, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          interpretationRagContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          console.log(`✅ Knowledge Base context retrieved for interpretation only (topK=${ragChatTopK}, indexId=${ragIndex.id}) — SQL step had no KB context`);
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context for interpretation:', ragError);
                      }
                  }
              } else if (dataSourceType === 'bigquery' && connectionConfig?.bigquery?.projectId) {
                  const ragIndex = await getRAGIndex(connectionConfig.bigquery.projectId, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          interpretationRagContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          console.log(`✅ Knowledge Base context retrieved for interpretation only (topK=${ragChatTopK}, indexId=${ragIndex.id}) — SQL step had no KB context`);
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context for interpretation:', ragError);
                      }
                  }
              } else if (dataSourceType === 'databricks') {
                  const databaseIdentifier = connectionConfig?.databricks?.database || connectionConfig?.database;
                  if (databaseIdentifier) {
                      const ragIndex = await getRAGIndex(databaseIdentifier, userId, userNameForRAG);
                      if (ragIndex) {
                          try {
                              interpretationRagContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                              console.log(`✅ Knowledge Base context retrieved for interpretation only (topK=${ragChatTopK}, indexId=${ragIndex.id}) — SQL step had no KB context`);
                          } catch (ragError) {
                              console.warn('⚠️ Error retrieving RAG context for interpretation:', ragError);
                          }
                      }
                  }
              } else if (dataSourceType === 'postgres' && connectionConfig?.postgres?.database) {
                  const ragIndex = await getRAGIndex(connectionConfig.postgres.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          interpretationRagContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          console.log(`✅ Knowledge Base context retrieved for interpretation only (topK=${ragChatTopK}, indexId=${ragIndex.id}) — SQL step had no KB context`);
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context for interpretation:', ragError);
                      }
                  }
              } else if (dataSourceType === 'redshift' && connectionConfig?.redshift?.database) {
                  const ragIndex = await getRAGIndex(connectionConfig.redshift.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          interpretationRagContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          console.log(`✅ Knowledge Base context retrieved for interpretation only (topK=${ragChatTopK}, indexId=${ragIndex.id}) — SQL step had no KB context`);
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context for interpretation:', ragError);
                      }
                  }
              } else if (dataSourceType === 'azure' && connectionConfig?.azure?.database) {
                  const ragIndex = await getRAGIndex(connectionConfig.azure.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          interpretationRagContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          console.log(`✅ Knowledge Base context retrieved for interpretation only (topK=${ragChatTopK}, indexId=${ragIndex.id}) — SQL step had no KB context`);
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context for interpretation:', ragError);
                      }
                  }
              } else if (dataSourceType === 'snowflake' && connectionConfig?.snowflake?.database) {
                  const ragIndex = await getRAGIndex(connectionConfig.snowflake.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          interpretationRagContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          console.log(`✅ Knowledge Base context retrieved for interpretation only (topK=${ragChatTopK}, indexId=${ragIndex.id}) — SQL step had no KB context`);
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context for interpretation:', ragError);
                      }
                  }
              } else if (dataSourceType === 'mysql' && connectionConfig?.mysql?.database) {
                  const ragIndex = await getRAGIndex(connectionConfig.mysql.database, userId, userNameForRAG);
                  if (ragIndex) {
                      try {
                          interpretationRagContext = await retrieveRAGContext(question, ragIndex.id, userId, ragChatTopK, userNameForRAG);
                          console.log(`✅ Knowledge Base context retrieved for interpretation only (topK=${ragChatTopK}, indexId=${ragIndex.id}) — SQL step had no KB context`);
                      } catch (ragError) {
                          console.warn('⚠️ Error retrieving RAG context for interpretation:', ragError);
                      }
                  }
              }
          }

          const buildDataDrivenFallbackInterpretation = (rows: any[], userQuestion: string): string => {
              if (!Array.isArray(rows) || rows.length === 0) {
                  return 'No rows were returned for this query. Try broadening filters or checking whether the selected period has data.';
              }

              const keys = Object.keys(rows[0] || {});
              const numericKeys = keys.filter((k) => rows.some((r) => Number.isFinite(Number(r?.[k]))));
              const nonNumericKeys = keys.filter((k) => !numericKeys.includes(k));

              // Common grouped-result shape: one dimension + one metric
              if (numericKeys.length >= 1 && nonNumericKeys.length >= 1) {
                  const metric = numericKeys[0];
                  const dimension = nonNumericKeys[0];
                  const ranked = rows
                      .map((r) => ({
                          label: String(r?.[dimension] ?? 'Unknown'),
                          value: Number(r?.[metric]),
                      }))
                      .filter((x) => Number.isFinite(x.value))
                      .sort((a, b) => b.value - a.value);

                  if (ranked.length > 0) {
                      const total = ranked.reduce((sum, x) => sum + x.value, 0);
                      const top1 = ranked[0];
                      const top2 = ranked[1];
                      const bottom = ranked[ranked.length - 1];
                      const topShare = total > 0 ? ((top1.value / total) * 100).toFixed(1) : '0.0';

                      const questionLine = userQuestion?.trim()
                          ? `For "${userQuestion.trim()}", the query returned ${ranked.length} grouped results.`
                          : `The query returned ${ranked.length} grouped results.`;

                      const secondLine = top2
                          ? `The top segment is ${top1.label} with ${top1.value.toLocaleString()} (${topShare}% of total), followed by ${top2.label} at ${top2.value.toLocaleString()}.`
                          : `The top segment is ${top1.label} with ${top1.value.toLocaleString()} (${topShare}% of total).`;

                      return `${questionLine} ${secondLine} In total there are ${total.toLocaleString()} ${metric} across all groups, and the lowest group is ${bottom.label} with ${bottom.value.toLocaleString()}.`;
                  }
              }

              if (numericKeys.length > 0) {
                  const metric = numericKeys[0];
                  const vals = rows
                      .map((r) => Number(r?.[metric]))
                      .filter((v) => Number.isFinite(v));
                  if (vals.length > 0) {
                      const sum = vals.reduce((a, b) => a + b, 0);
                      const avg = sum / vals.length;
                      const min = Math.min(...vals);
                      const max = Math.max(...vals);
                      return `The query returned ${rows.length} rows. For ${metric}, the average is ${avg.toLocaleString(undefined, { maximumFractionDigits: 2 })}, ranging from ${min.toLocaleString()} to ${max.toLocaleString()}, with a total of ${sum.toLocaleString()}.`;
                  }
              }

              return `The query returned ${rows.length} rows. I can see multiple records, but this result shape is mostly categorical text; add a numeric metric (count, amount, or score) to generate deeper quantitative insights.`;
          };

          const visualizable =
              chatAutoViz &&
              visualizationService.isDataVisualizable(queryResults) &&
              queryResults.length > 0;

          if (!chatLlmInterpretation) {
              interpretation = buildDataDrivenFallbackInterpretation(queryResults, question);
              try {
                  if (visualizable) {
                      const vizResult = await visualizationService.generateLLMVisualization({
                          data: queryResults,
                          question: question,
                          userId: userId,
                      });
                      if (vizResult.success && vizResult.imagePath) {
                          imagePath = vizResult.imagePath;
                      }
                  }
              } catch (vizErr) {
                  console.error('Error generating visualization:', vizErr);
              }
          } else {
              const interpretPromise = llm.interpretSQLResults(
                  question,
                  finalQuery,
                  queryResults,
                  userName || 'User',
                  apiKey,
                  interpretationRagContext || undefined,
                  llmModel
              );
              const vizPromise = visualizable
                  ? visualizationService.generateLLMVisualization({
                        data: queryResults,
                        question: question,
                        userId: userId,
                    })
                  : Promise.resolve({ success: false as const });

              const [interpSettled, vizSettled] = await Promise.allSettled([interpretPromise, vizPromise]);

              if (interpSettled.status === 'fulfilled') {
                  interpretation = interpSettled.value;
              } else {
                  console.error('Error interpreting SQL results:', interpSettled.reason);
                  interpretation = buildDataDrivenFallbackInterpretation(queryResults, question);
              }

              if (vizSettled.status === 'fulfilled') {
                  const vr = vizSettled.value as { success?: boolean; imagePath?: string };
                  if (vr.success && vr.imagePath) {
                      imagePath = vr.imagePath;
                  }
              } else {
                  console.error('Error generating visualization:', vizSettled.reason);
              }
          }
      } catch (error) {
          console.error('Error in interpret/visualize step:', error);
          interpretation = buildDataDrivenFallbackInterpretation(queryResults, question);
      }

      /** LLM may return empty JSON draft or markdown-only content that strips to blank — never ship an empty Response bubble. */
      if (typeof interpretation === 'string') {
          interpretation = interpretation.trim();
      } else {
          interpretation = '';
      }
      if (!interpretation) {
          interpretation = buildDataDrivenFallbackInterpretation(queryResults, question);
      }

      const executionStepsForClient = buildExecutionSteps(chatHistoryQuestion);

      const chatLlmFollowUp =
          process.env.CHAT_LLM_FOLLOW_UP !== '0' &&
          String(process.env.CHAT_LLM_FOLLOW_UP ?? '1').toLowerCase() !== 'false';

      let followUpQuestionsForClient: string[] = [];
      if (chatLlmFollowUp && apiKey) {
          const hasDataAnswer =
              Boolean(finalQuery && String(finalQuery).trim()) ||
              (Array.isArray(queryResults) && queryResults.length > 0);
          if (hasDataAnswer) {
              try {
                  followUpQuestionsForClient = await generateFollowUpSuggestions({
                      userQuestion: chatHistoryQuestion,
                      interpretation,
                      sqlQuery: finalQuery,
                      queryResults,
                      provider: llmProvider,
                      apiKey,
                      model: llmModel,
                  });
              } catch (fuErr) {
                  console.warn('Follow-up suggestions LLM failed:', fuErr);
              }
          }
      }

      // Save chat history if user is authenticated
      let sessionId: string | undefined;
      if (userId) {
          try {
              // Get session ID from request body - if not provided, backend will create a new one
              // IMPORTANT: Only use sessionId if explicitly provided (user selected a session)
              // If undefined or not provided, each query gets its own new session
              const requestSessionId = req.body.sessionId; // Will be undefined if not provided
              console.log('💾 Saving chat history:', {
                  userId,
                  requestSessionId: requestSessionId || 'NEW (will be created)',
                  questionLength: chatHistoryQuestion?.length,
                  mergedQuestionLen: question?.length,
                  responseLength: interpretation?.length,
              });
              const savedMessage = await chatHistoryService.saveChatMessage({
                  userId,
                  sessionId: requestSessionId, // Pass undefined if not provided - service will create new session
                  question: chatHistoryQuestion,
                  response: interpretation,
                  sqlQuery: finalQuery,
                  queryResults: queryResults.length > 0 ? queryResults : undefined,
                  executionSteps: executionStepsForClient,
                  followUpQuestions:
                      followUpQuestionsForClient.length > 0 ? followUpQuestionsForClient : undefined
              });
              sessionId = savedMessage.sessionId;
              console.log('✅ Chat history saved successfully:', { sessionId, messageId: savedMessage.id, isNewSession: !requestSessionId });
          } catch (error) {
              console.error('❌ Failed to save chat history:', error);
              console.error('Error details:', error instanceof Error ? error.stack : error);
              // Don't fail the request if chat history saving fails
          }
      } else {
          console.log('⚠️ Chat history not saved - no userId:', { bodyUserId, reqUserId: req.userId, hasAuthHeader: !!req.headers['authorization'] });
      }

      // Return response
      const response: any = {
          interpretation: interpretation,
          sqlQuery: finalQuery,
          queryResults: queryResults,
          dataSourceType: dataSourceType,
          executionSteps: executionStepsForClient,
          followUpQuestions: followUpQuestionsForClient
      };

      if (imagePath) {
          // Clients use /api/chart/:filename — never expose server absolute paths
          response.imagePath = path.basename(imagePath);
      }

      if (sessionId) {
          response.sessionId = sessionId;
      }

      res.json(response);

  } catch (error) {
      console.error('Error processing chat request:', error);
      res.status(500).json({ 
          error: 'Failed to process your question',
          message: error instanceof Error ? error.message : 'Unknown error'
      });
  }
});

// POST /api/visualize - Generate or regenerate visualizations
app.post('/api/visualize', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      const { data, action, question, userStyleRequest } = req.body;

      if (!data || !Array.isArray(data) || data.length === 0) {
          return res.status(400).json({ 
              success: false,
              error: 'Data is required and must be a non-empty array' 
          });
      }

      // Extract chart type from action if present (e.g., "changeChartType-bar")
      let chartType: string | undefined;
      if (action && action.includes('changeChartType-')) {
          chartType = action.split('changeChartType-')[1];
      }

      console.log('Generating visualization with chart type:', chartType || 'auto');

      const vizResult = await visualizationService.generateLLMVisualization({
          data: data,
          question: question || 'Visualize this data',
          chartType: chartType,
          userStyleRequest: userStyleRequest || (action && action.includes('changeChartType') ? action : undefined),
          userId: req.userId // Pass userId to use user's LLM configuration
      });

      if (vizResult.success && vizResult.imagePath) {
          res.json({
              success: true,
              imagePath: path.basename(vizResult.imagePath),
              chartType: vizResult.chartType
          });
      } else {
          res.status(500).json({
              success: false,
              error: vizResult.error || 'Failed to generate visualization'
          });
      }

  } catch (error) {
      console.error('Error generating visualization:', error);
      res.status(500).json({ 
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error occurred'
      });
  }
});

// POST /api/query/execute - Execute a SQL query directly
app.post('/api/query/execute', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
      const { sqlQuery, connectionConfig, userId: bodyUserId } = req.body;

      if (!sqlQuery || typeof sqlQuery !== 'string' || sqlQuery.trim() === '') {
          return res.status(400).json({ 
              success: false,
              error: 'SQL query is required' 
          });
      }

      // Use userId from body (for Slack/internal calls) or from auth token (for frontend)
      const userId = bodyUserId || req.userId;

      let results: any[] = [];

      // Get connection config from user if authenticated and not provided
      let config = connectionConfig;
      if (!config && userId) {
          const configs = await connectionConfigService.getConnectionConfigs(userId);
          const connectedConfigs = configs.filter(c => c.connectionStatus === 'connected');
          
          if (connectedConfigs.length > 0) {
              // Find first connected config (prioritize by data source type order)
              let selectedConfig = connectedConfigs.find(c => c.sourceType === 'airtable');
              if (!selectedConfig) {
                  selectedConfig = connectedConfigs.find(c => c.sourceType === 'bigquery');
              }
              if (!selectedConfig) {
                  selectedConfig = connectedConfigs.find(c => c.sourceType === 'databricks');
              }
              if (!selectedConfig) {
                  selectedConfig = connectedConfigs.find(c => c.sourceType === 'postgres' || c.sourceType === 'postgresql');
              }
              if (!selectedConfig) {
                  selectedConfig = connectedConfigs.find(c => c.sourceType === 'redshift');
              }
              if (!selectedConfig) {
                  selectedConfig = connectedConfigs.find(c => c.sourceType === 'azure' || c.sourceType === 'sqlserver');
              }
              if (!selectedConfig) {
                  selectedConfig = connectedConfigs.find(c => c.sourceType === 'snowflake');
              }
              if (!selectedConfig) {
                  selectedConfig = connectedConfigs.find(c => c.sourceType === 'mysql');
              }
              if (!selectedConfig) {
                  selectedConfig = connectedConfigs[0];
              }
              
              if (selectedConfig) {
                  const configData = selectedConfig.config as any;
                  if (selectedConfig.sourceType === 'airtable' && configData.apiKey && configData.baseId) {
                      config = {
                          airtable: {
                              apiKey: configData.apiKey,
                              baseId: configData.baseId
                          }
                      };
                  } else if (selectedConfig.sourceType === 'bigquery' && configData.projectId && configData.serviceAccountKey) {
                      config = {
                          bigquery: {
                              projectId: configData.projectId,
                              serviceAccountKey: configData.serviceAccountKey
                          }
                      };
                  } else if (selectedConfig.sourceType === 'databricks' && configData.database) {
                      config = {
                          databricks: {
                              host: configData.host,
                              server: configData.server,
                              serverHostname: configData.serverHostname,
                              port: configData.port,
                              database: configData.database,
                              schema: configData.schema,
                              httpPath: configData.httpPath,
                              accessToken: configData.accessToken,
                              token: configData.token,
                              connectionMethod: configData.connectionMethod,
                              jdbcUrl: configData.jdbcUrl,
                              tokenName: configData.tokenName,
                              clientId: configData.clientId,
                              clientSecret: configData.clientSecret
                          }
                      };
                  } else if ((selectedConfig.sourceType === 'postgres' || selectedConfig.sourceType === 'postgresql') && configData.database) {
                      config = {
                          postgres: {
                              host: configData.host || configData.server,
                              server: configData.server,
                              port: configData.port,
                              database: configData.database,
                              username: configData.username,
                              password: configData.password,
                              schema: configData.schema,
                              httpPath: configData.httpPath,
                              accessToken: configData.accessToken
                          }
                      };
                  } else if (selectedConfig.sourceType === 'redshift' && configData.database) {
                      config = {
                          redshift: {
                              host: configData.host || configData.server,
                              server: configData.server,
                              port: configData.port,
                              database: configData.database,
                              username: configData.username,
                              password: configData.password,
                              schema: configData.schema,
                              httpPath: configData.httpPath,
                              accessToken: configData.accessToken
                          }
                      };
                  } else if ((selectedConfig.sourceType === 'azure' || selectedConfig.sourceType === 'sqlserver') && configData.database) {
                      config = {
                          azure: {
                              host: configData.host || configData.server,
                              server: configData.server,
                              port: configData.port,
                              database: configData.database,
                              username: configData.username,
                              password: configData.password,
                              schema: configData.schema,
                              httpPath: configData.httpPath,
                              accessToken: configData.accessToken
                          }
                      };
                  } else if (selectedConfig.sourceType === 'snowflake' && configData.database) {
                      config = {
                          snowflake: {
                              host: configData.host || configData.server,
                              server: configData.server,
                              port: configData.port,
                              database: configData.database,
                              username: configData.username,
                              password: configData.password,
                              schema: configData.schema,
                              account: configData.account,
                              warehouse: configData.warehouse,
                              httpPath: configData.httpPath,
                              accessToken: configData.accessToken
                          }
                      };
                  } else if (selectedConfig.sourceType === 'mysql' && configData.database) {
                      config = {
                          mysql: {
                              host: configData.host || configData.server,
                              server: configData.server,
                              port: configData.port,
                              database: configData.database,
                              username: configData.username,
                              password: configData.password,
                              schema: configData.schema,
                              httpPath: configData.httpPath,
                              accessToken: configData.accessToken
                          }
                      };
                  }
              }
          }
      }

      if (!config) {
          return res.status(400).json({
              success: false,
              error: 'No database connection configured'
          });
      }

      // Determine data source type and build DataSourceConfig
      // Note: QueryExecutor.executeQuery uses validateAndExecuteSQL internally, which handles validation
      let dataSourceConfig: DataSourceConfig | undefined;
      
      if (config.airtable) {
          // For Airtable, we need to use the Airtable API (SQL-like queries not directly supported)
          return res.status(400).json({
              success: false,
              error: 'Direct SQL execution is not supported for Airtable. Please use natural language queries.'
          });
      } else if (config.bigquery) {
          dataSourceConfig = { type: 'bigquery', bigquery: config.bigquery };
      } else if (config.databricks) {
          dataSourceConfig = { type: 'databricks', databricks: config.databricks };
      } else if (config.postgres || config.postgresql) {
          dataSourceConfig = { type: 'postgres', postgres: config.postgres || config.postgresql };
      } else if (config.redshift) {
          dataSourceConfig = { type: 'redshift', redshift: config.redshift };
      } else if (config.azure || config.sqlserver) {
          dataSourceConfig = { type: 'azure', azure: config.azure || config.sqlserver };
      } else if (config.snowflake) {
          dataSourceConfig = { type: 'snowflake', snowflake: config.snowflake };
      } else if (config.mysql) {
          dataSourceConfig = { type: 'mysql', mysql: config.mysql };
      }
      
      if (!dataSourceConfig) {
          return res.status(400).json({
              success: false,
              error: 'Unsupported database type for direct SQL execution'
          });
      }

      // Execute query using QueryExecutor (which uses validateAndExecuteSQL internally for validation)
      try {
          results = await QueryExecutor.executeQuery(sqlQuery, dataSourceConfig);
      } catch (error) {
          console.error('Error executing SQL query:', error);
          return res.status(400).json({
              success: false,
              error: error instanceof Error ? error.message : 'Failed to execute SQL query'
          });
      }

      res.json({
          success: true,
          results: results,
          rowCount: results.length
      });

  } catch (error) {
      console.error('Error executing SQL:', error);
      res.status(500).json({ 
          success: false,
          error: error instanceof Error ? error.message : 'Failed to execute SQL query'
      });
  }
});

// POST /api/explain-sql - Explain SQL query using LLM
app.post('/api/explain-sql', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
      const { sqlQuery, llmProvider, llmApiKey, llmModel, userId: bodyUserId } = req.body;

      if (!sqlQuery || typeof sqlQuery !== 'string' || sqlQuery.trim() === '') {
          return res.status(400).json({ 
              success: false,
              error: 'SQL query is required' 
          });
      }

      // Use userId from body (for Slack/internal calls) or from auth token (for frontend)
      const userId = bodyUserId || req.userId;

      const preferredExplain = parseLLMProviderString(
        typeof llmProvider === 'string' ? llmProvider : undefined
      );
      const requestApiKey =
          typeof llmApiKey === 'string' && llmApiKey.trim().length > 0 ? llmApiKey.trim() : '';
      const requestModel =
          typeof llmModel === 'string' && llmModel.trim().length > 0 ? llmModel.trim() : undefined;
      const llmConfig: LLMConfig | null =
          preferredExplain && requestApiKey
              ? {
                    provider: preferredExplain,
                    apiKey: requestApiKey,
                    model: requestModel,
                    useLightModel: false,
                }
              : await getLLMConfig(userId, preferredExplain);

      if (preferredExplain && requestApiKey) {
          console.log(
              `[LLM Config] source=request userId=${userId ?? 'anon'} provider=${preferredExplain} model=${requestModel || 'default'} endpoint=explain-sql`
          );
      }
      
      if (!llmConfig) {
          return res.status(400).json({ 
              success: false,
              error: 'LLM API key is required. Configure LLM settings or set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY.' 
          });
      }
      
      // Set provider and get API key from config
      llm.setProvider(llmConfig.provider);
      const apiKey = llmConfig.apiKey;

      const explanation = await llm.explainSQL(sqlQuery, apiKey, llmConfig?.model);

      res.json({
          success: true,
          explanation: explanation
      });

  } catch (error) {
      console.error('Error explaining SQL:', error);
      res.status(500).json({ 
          success: false,
          error: error instanceof Error ? error.message : 'Failed to explain SQL query'
      });
  }
});

// GET /api/chart/:imagePath - Serve chart images
app.get('/api/chart/:imagePath', (req, res) => {
  try {
      const imagePath = decodeURIComponent(req.params.imagePath);
      
      // Security: Only allow files from the temp directory
      const tempDir = path.join(require('os').tmpdir(), 'visualizations');
      const fullPath = path.join(tempDir, imagePath);
      
      // Ensure the path is within the temp directory (prevent directory traversal)
      if (!fullPath.startsWith(tempDir)) {
          return res.status(403).json({ error: 'Invalid image path' });
      }

      if (fs.existsSync(fullPath)) {
          res.sendFile(fullPath);
      } else {
          res.status(404).json({ error: 'Chart image not found' });
      }
  } catch (error) {
      console.error('Error serving chart:', error);
      res.status(500).json({ error: 'Failed to serve chart' });
  }
});

// ==================== Cloudflare Turnstile ====================
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

async function verifyTurnstileToken(token: string): Promise<boolean> {
  const secret = (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.VITE_CLOUDFLARE_TURNSTILE_SECRET_KEY || '').trim();
  if (!secret) {
      console.error('Turnstile: CLOUDFLARE_TURNSTILE_SECRET_KEY not set - cannot verify token');
      return false;
  }
  try {
      const formData = new URLSearchParams();
      formData.append('secret', secret);
      formData.append('response', token);
      const { data } = await axios.post(TURNSTILE_VERIFY_URL, formData, {
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          timeout: 10000,
      });
      if (data?.success !== true && data?.['error-codes']) {
          console.error('Turnstile siteverify failed, error-codes:', data['error-codes']);
      }
      return data?.success === true;
  } catch (err) {
      console.error('Turnstile verify error:', err);
      return false;
  }
}

// ==================== Authentication Endpoints ====================

// POST /api/auth/send-verification-code - Send verification code to email
app.post('/api/auth/send-verification-code', async (req, res) => {
  try {
      // Cloudflare tutorial: server reads req.body["cf-turnstile-response"]
      const turnstileToken = (req.body && (req.body['cf-turnstile-response'] ?? req.body.turnstileToken)) || null;
      if (!turnstileToken) {
          console.error('Turnstile: /api/auth/send-verification-code received request but no token in body (cf-turnstile-response or turnstileToken missing)');
      }
      const { email, password, name, phoneNumber } = req.body;

      if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
      }

      // Validate password requirements (12 characters minimum)
      if (password.length < 12) {
          return res.status(400).json({ error: 'Password must be at least 12 characters' });
      }
      if (!/[a-z]/.test(password)) {
          return res.status(400).json({ error: 'Password must contain at least one lowercase letter' });
      }
      if (!/[A-Z]/.test(password)) {
          return res.status(400).json({ error: 'Password must contain at least one uppercase letter' });
      }
      if (!/[0-9]/.test(password)) {
          return res.status(400).json({ error: 'Password must contain at least one number' });
      }
      if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
          return res.status(400).json({ error: 'Password must contain at least one special character' });
      }

      const turnstileSecret = (process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY || process.env.VITE_CLOUDFLARE_TURNSTILE_SECRET_KEY || '').trim();
      if (turnstileSecret) {
          if (!turnstileToken || turnstileToken === 'dev-bypass') {
              console.error('Turnstile: token missing or dev-bypass in request body (expected turnstileToken or cf-turnstile-response)');
              return res.status(400).json({ error: 'Please complete the security verification' });
          }
          const valid = await verifyTurnstileToken(turnstileToken);
          if (!valid) {
              console.error('Turnstile: siteverify returned invalid or failure (check CLOUDFLARE_TURNSTILE_SECRET_KEY matches Site Key pair, token not expired)');
              return res.status(400).json({ error: 'Security verification failed. Please try again.' });
          }
      }

      // Check if user already exists
      const pool = getDatabasePool();
      const existingUser = await pool.query(
          'SELECT id FROM users WHERE email = $1',
          [email.toLowerCase()]
      );

      if (existingUser.rows.length > 0) {
          return res.status(400).json({ error: 'User with this email already exists' });
      }

      // Hash password for temporary storage
      const bcrypt = require('bcryptjs');
      const passwordHash = await bcrypt.hash(password, 10);

      // Store pending registration
      await emailVerificationService.storePendingRegistration(email, passwordHash, name, phoneNumber);

      // Generate and store verification code
      const code = emailVerificationService.generateVerificationCode();
      await emailVerificationService.storeVerificationCode(email, code);

      // Send verification code
      await emailVerificationService.sendVerificationCode(email, code);

      res.status(200).json({
          success: true,
          message: 'Verification code sent to your email'
      });
  } catch (error: any) {
      console.error('Error sending verification code:', error);
      res.status(400).json({ error: error.message || 'Failed to send verification code' });
  }
});

// POST /api/auth/verify-email - Verify email with code and create user
app.post('/api/auth/verify-email', async (req, res) => {
  try {
      const { email, code } = req.body;

      if (!email || !code) {
          return res.status(400).json({ error: 'Email and verification code are required' });
      }

      // Verify code
      const verification = await emailVerificationService.verifyCode(email, code);

      if (!verification.valid) {
          return res.status(400).json({ error: 'Invalid or expired verification code' });
      }

      // Get pending registration data
      const regData = await emailVerificationService.getPendingRegistration(email);

      if (!regData) {
          return res.status(400).json({ error: 'Registration data not found or expired. Please sign up again.' });
      }

      // Create user
      const userId = await emailVerificationService.createVerifiedUser(
          email,
          regData.passwordHash,
          regData.name,
          regData.phoneNumber
      );

      // Delete pending registration
      const pool = getDatabasePool();
      await pool.query(
          'DELETE FROM pending_registrations WHERE email = $1',
          [email.toLowerCase()]
      );

      // Create user's RAG directory
      try {
          const { createUserRAGDirectory } = require('./services/rag_service/rag.service');
          createUserRAGDirectory(userId, regData.name || email);
      } catch (error) {
          console.warn('Failed to create RAG directory:', error);
      }

      // Create default free subscription
      try {
          await subscriptionService.createSubscription({
              userId,
              planName: 'free',
              planType: 'monthly',
              currentPeriodStart: new Date(),
              currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          });
      } catch (error) {
          console.warn('Failed to create default subscription:', error);
      }

      // Login user and return token (we need to get the password from pending registration)
      // Since we only have the hash, we'll create a temporary login
      // Actually, we need to store the plain password temporarily or use a different approach
      // For now, let's generate a token directly
      const jwt = require('jsonwebtoken');
      const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
      const token = jwt.sign({ userId, email: email.toLowerCase() }, JWT_SECRET, { expiresIn: '7d' });

      // Get user data
      const userResult = await pool.query(
          'SELECT id, email, name, created_at, updated_at FROM users WHERE id = $1',
          [userId]
      );
      const user = {
          id: userResult.rows[0].id,
          email: userResult.rows[0].email,
          name: userResult.rows[0].name,
          createdAt: userResult.rows[0].created_at,
          updatedAt: userResult.rows[0].updated_at,
      };

      res.status(200).json({
          success: true,
          token: token,
          user: user,
          planName: 'free', // Default to free plan
          userId: userId,
          message: 'Email verified and account created successfully'
      });
  } catch (error: any) {
      console.error('Error verifying email:', error);
      res.status(400).json({ error: error.message || 'Failed to verify email' });
  }
});

// POST /api/auth/register - User registration (deprecated, use send-verification-code instead)
app.post('/api/auth/register', async (req, res) => {
  try {
      const { email, password, name } = req.body;

      if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
      }

      if (password.length < 12) {
          return res.status(400).json({ error: 'Password must be at least 12 characters' });
      }

      const user = await userService.createUser({ email, password, name });
      const loginResult = await userService.login({ email, password });

      res.status(201).json({
          success: true,
          user: loginResult.user,
          token: loginResult.token,
          message: 'User registered successfully'
      });
  } catch (error: any) {
      console.error('Error registering user:', error);
      res.status(400).json({ error: error.message || 'Failed to register user' });
  }
});

// POST /api/auth/forgot-password - Request password reset email
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
      const email = (req.body?.email || '').trim().toLowerCase();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
          return res.status(400).json({ error: 'Please enter a valid email address.' });
      }

      const user = await userService.getUserByEmail(email);
      if (!user) {
          return res.status(404).json({
              error: 'The email does not exist in our platform.',
          });
      }

      const pool = getDatabasePool();
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
      await pool.query(
          'INSERT INTO password_reset_tokens (token, email, expires_at) VALUES ($1, $2, $3)',
          [token, email, expiresAt]
      );

      const frontendUrl = (process.env.FRONTEND_URL || '').trim() || 'http://localhost:5173';
      const resetLink = `${frontendUrl.replace(/\/$/, '')}/reset-password/${token}`;
      await emailVerificationService.sendPasswordResetEmail(email, resetLink);

      res.status(200).json({
          success: true,
          message: 'If an account exists with this email, you will receive a password reset link shortly.',
      });
  } catch (error: any) {
      console.error('Forgot password error:', error);
      res.status(500).json({ error: error.message || 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/reset-password - Set new password using token from email
app.post('/api/auth/reset-password', async (req, res) => {
  try {
      const { token, newPassword } = req.body;
      if (!token || typeof token !== 'string') {
          return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new one.' });
      }
      if (!newPassword || typeof newPassword !== 'string') {
          return res.status(400).json({ error: 'New password is required.' });
      }
      if (newPassword.length < 12) {
          return res.status(400).json({ error: 'Password must be at least 12 characters.' });
      }
      if (!/[a-z]/.test(newPassword)) {
          return res.status(400).json({ error: 'Password must contain at least one lowercase letter.' });
      }
      if (!/[A-Z]/.test(newPassword)) {
          return res.status(400).json({ error: 'Password must contain at least one uppercase letter.' });
      }
      if (!/[0-9]/.test(newPassword)) {
          return res.status(400).json({ error: 'Password must contain at least one number.' });
      }
      if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(newPassword)) {
          return res.status(400).json({ error: 'Password must contain at least one special character.' });
      }
      const pool = getDatabasePool();
      const result = await pool.query(
          'SELECT email FROM password_reset_tokens WHERE token = $1 AND expires_at > CURRENT_TIMESTAMP',
          [token.trim()]
      );
      if (result.rows.length === 0) {
          return res.status(400).json({ error: 'Invalid or expired reset link. Please request a new password reset.' });
      }
      const email = result.rows[0].email;
      const updated = await userService.updatePasswordByEmail(email, newPassword);
      if (!updated) {
          return res.status(400).json({ error: 'Could not update password. Please try again or request a new link.' });
      }
      await pool.query('DELETE FROM password_reset_tokens WHERE token = $1', [token.trim()]);
      res.status(200).json({ success: true, message: 'Your password has been reset. You can now sign in.' });
  } catch (error: any) {
      console.error('Reset password error:', error);
      res.status(500).json({ error: error.message || 'Something went wrong. Please try again.' });
  }
});

// POST /api/auth/login - User login
app.post('/api/auth/login', async (req, res) => {
  try {
      const { email, password } = req.body;

      if (!email || !password) {
          return res.status(400).json({ error: 'Email and password are required' });
      }

      const result = await userService.login({ email, password });
      const adminIds = (process.env.ADMIN_USER_IDS || '').trim().split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      const isSiteAdmin = adminIds.includes(result.user.id);

      res.json({
          success: true,
          user: { ...result.user, isSiteAdmin },
          token: result.token
      });
  } catch (error: any) {
      console.error('Error logging in:', error);
      res.status(401).json({ error: error.message || 'Invalid credentials' });
  }
});

// GET /api/auth/me - Get current user
app.get('/api/auth/me', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const user = await userService.getUserById(req.userId);
      if (!user) {
          return res.status(404).json({ error: 'User not found' });
      }

      const adminIds = (process.env.ADMIN_USER_IDS || '').trim().split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
      const isSiteAdmin = adminIds.includes(req.userId);

      res.json({ success: true, user: { ...user, isSiteAdmin } });
  } catch (error: any) {
      console.error('Error getting user:', error);
      res.status(500).json({ error: 'Failed to get user information' });
  }
});

// POST /api/auth/create-rag-folder - Create RAG folder for current user (for existing users)
app.post('/api/auth/create-rag-folder', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      // Fetch user info to get name
      const user = await userService.getUserById(req.userId);
      if (!user) {
          return res.status(404).json({ error: 'User not found' });
      }

      // This will create the folder if it doesn't exist
      const { createUserRAGDirectory } = await import('./services/rag_service/rag.service');
      createUserRAGDirectory(req.userId, user.name || user.email);

      res.json({ 
          success: true, 
          message: 'RAG folder created successfully',
          userId: req.userId
      });
  } catch (error: any) {
      console.error('Error creating RAG folder:', error);
      res.status(500).json({ error: 'Failed to create RAG folder' });
  }
});

// DELETE /api/auth/account - Delete current user account
app.delete('/api/auth/account', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const deleted = await userService.deleteUser(req.userId);
      
      if (deleted) {
          // Optionally delete RAG folder (optional, as it's just files)
          try {
              const fs = require('fs');
              const path = require('path');
              const ragDir = path.join(getRagIndicesRoot(), `user_${req.userId}`);
              if (fs.existsSync(ragDir)) {
                  fs.rmSync(ragDir, { recursive: true, force: true });
                  console.log(`Deleted RAG folder for user ${req.userId}`);
              }
          } catch (fsError) {
              console.warn(`Could not delete RAG folder for user ${req.userId}:`, fsError);
              // Don't fail the request if folder deletion fails
          }

          res.json({ 
              success: true, 
              message: 'Account deleted successfully' 
          });
      } else {
          res.status(404).json({ error: 'User not found' });
      }
  } catch (error: any) {
      console.error('Error deleting account:', error);
      res.status(500).json({ error: 'Failed to delete account' });
  }
});

// ==================== Connection Config Endpoints ====================

// GET /api/connections - Get all connection configs for current user
app.get('/api/connections', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const configs = await connectionConfigService.getConnectionConfigs(req.userId);
      
      // Convert to format expected by frontend
      const connections: { [key: string]: any } = {};
      configs.forEach(config => {
          connections[config.sourceId] = {
              ...config.config,
              _connectionStatus: config.connectionStatus
          };
      });

      res.json({ success: true, connections });
  } catch (error: any) {
      console.error('Error getting connection configs:', error);
      res.status(500).json({ error: 'Failed to get connection configs' });
  }
});

// POST /api/demo-request - Handle demo request form submission (Request Demo on /contact)
app.post('/api/demo-request', async (req, res) => {
  try {
      const { firstName, lastName, email, companyName, jobTitle, phoneNumber, timeZone, projectDescription } = req.body;

      if (!firstName || !lastName || !email || !companyName || !jobTitle || !phoneNumber || !timeZone || !projectDescription) {
          return res.status(400).json({ error: 'All fields are required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
          return res.status(400).json({ error: 'Invalid email format' });
      }

      const pool = getDatabasePool();
      await pool.query(
          `INSERT INTO demo_requests (first_name, last_name, email, company_name, job_title, phone_number, time_zone, project_description)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
              String(firstName).trim(),
              String(lastName).trim(),
              String(email).trim().toLowerCase(),
              String(companyName).trim(),
              String(jobTitle).trim(),
              String(phoneNumber).trim(),
              String(timeZone).trim(),
              String(projectDescription).trim(),
          ]
      );

      await resendService.sendDemoRequestEmail({
          firstName: String(firstName).trim(),
          lastName: String(lastName).trim(),
          email: String(email).trim(),
          companyName: String(companyName).trim(),
          jobTitle: String(jobTitle).trim(),
          phoneNumber: String(phoneNumber).trim(),
          timeZone: String(timeZone).trim(),
          projectDescription: String(projectDescription).trim(),
      });

      try {
          await resendService.sendAutoReply(String(email).trim(), 'demo');
      } catch (_) { /* optional */ }

      res.status(200).json({
          success: true,
          message: 'Thank you! We\'ve received your demo request and will reply at your email within 1–2 business days.',
      });
  } catch (error: any) {
      console.error('Error processing demo request:', error);
      res.status(500).json({ error: error.message || 'Failed to submit demo request' });
  }
});

// POST /api/contact-support - Help → Contact Support: store in DB and send via Resend to support@aiquery.ai
app.post('/api/contact-support', optionalAuth, async (req: AuthenticatedRequest, res) => {
  try {
      const { name, email, subject, message } = req.body;

      if (!email || !message) {
          return res.status(400).json({ error: 'Email and message are required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
          return res.status(400).json({ error: 'Invalid email format' });
      }

      const fromName = (name || '').trim() || 'Support request';
      const subj = (subject || '').trim() || `AIquery Support: ${fromName}`;
      const msg = (message || '').trim();
      const userId = req.userId ?? null;

      const pool = getDatabasePool();
      await pool.query(
          `INSERT INTO support_requests (user_id, name, email, subject, message) VALUES ($1, $2, $3, $4, $5)`,
          [userId, fromName, String(email).trim().toLowerCase(), subj || null, msg]
      );

      await resendService.sendSupportEmail(fromName, String(email).trim(), subj, msg);

      try {
          await resendService.sendAutoReply(String(email).trim(), 'support');
      } catch (_) { /* optional */ }

      res.status(200).json({
          success: true,
          message: 'We\'ve received your message and will reply at your email within 1–2 business days.',
      });
  } catch (error: any) {
      console.error('Error sending support request:', error);
      res.status(500).json({ error: error.message || 'Failed to send support request' });
  }
});

// POST /api/contact-message - Contact form (name, email, message) from /contact and other pages: store in DB and send via Resend
app.post('/api/contact-message', async (req, res) => {
  try {
      const { name, email, subject, message } = req.body;

      if (!email || !message) {
          return res.status(400).json({ error: 'Email and message are required' });
      }

      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
          return res.status(400).json({ error: 'Invalid email format' });
      }

      const fromName = (name || '').trim() || 'Contact';
      const subj = (subject || '').trim() || `AIquery Contact: ${fromName}`;
      const msg = (message || '').trim();

      const pool = getDatabasePool();
      await pool.query(
          `INSERT INTO contact_messages (name, email, subject, message) VALUES ($1, $2, $3, $4)`,
          [fromName, String(email).trim().toLowerCase(), subj || null, msg]
      );

      await resendService.sendContactMessageEmail(fromName, String(email).trim(), subj, msg);

      try {
          await resendService.sendAutoReply(String(email).trim(), 'contact');
      } catch (_) { /* optional */ }

      res.status(200).json({
          success: true,
          message: 'We\'ve received your message and will reply at your email within 1–2 business days.',
      });
  } catch (error: any) {
      console.error('Error sending contact message:', error);
      res.status(500).json({ error: error.message || 'Failed to send message' });
  }
});

// ==================== Admin Dashboard API (requires ADMIN_USER_IDS) ====================

// GET /api/admin/users - List all users (admin only)
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const pool = getDatabasePool();
      const search = (req.query.search as string) || '';
      let query = 'SELECT id, email, name, role, phone_number, email_verified, status, created_at, updated_at FROM users WHERE 1=1';
      const params: unknown[] = [];
      if (search.trim()) {
          params.push(`%${search.trim().toLowerCase()}%`);
          query += ` AND (LOWER(email) LIKE $${params.length} OR LOWER(COALESCE(name,'')) LIKE $${params.length})`;
      }
      query += ' ORDER BY created_at DESC LIMIT 500';
      const result = await pool.query(query, params);
      res.json({ success: true, users: result.rows });
  } catch (error: any) {
      console.error('Admin users error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch users' });
  }
});

// POST /api/admin/users - Create a new user (admin only)
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const { email, name, password } = req.body || {};
      const emailTrim = (email || '').trim().toLowerCase();
      if (!emailTrim) {
          return res.status(400).json({ error: 'Email is required.' });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailTrim)) {
          return res.status(400).json({ error: 'Please enter a valid email address.' });
      }
      if (!password || typeof password !== 'string') {
          return res.status(400).json({ error: 'Password is required.' });
      }
      if (password.length < 12) {
          return res.status(400).json({ error: 'Password must be at least 12 characters.' });
      }
      if (!/[a-z]/.test(password)) {
          return res.status(400).json({ error: 'Password must contain at least one lowercase letter.' });
      }
      if (!/[A-Z]/.test(password)) {
          return res.status(400).json({ error: 'Password must contain at least one uppercase letter.' });
      }
      if (!/[0-9]/.test(password)) {
          return res.status(400).json({ error: 'Password must contain at least one number.' });
      }
      if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
          return res.status(400).json({ error: 'Password must contain at least one special character.' });
      }
      const user = await userService.createUser({
          email: emailTrim,
          password,
          name: (name || '').trim() || undefined,
      });
      res.status(201).json({ success: true, user: { id: user.id, email: user.email, name: user.name } });
  } catch (error: any) {
      if (error.message === 'User with this email already exists') {
          return res.status(409).json({ error: error.message });
      }
      console.error('Admin create user error:', error);
      res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

// PATCH /api/admin/users/:userId/status - Update user status: active | paused | stopped (admin only)
app.patch('/api/admin/users/:userId/status', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const userId = parseInt(req.params.userId, 10);
      if (isNaN(userId) || userId < 1) {
          return res.status(400).json({ error: 'Invalid user ID.' });
      }
      const status = (req.body?.status || '').toLowerCase();
      if (status !== 'active' && status !== 'paused' && status !== 'stopped') {
          return res.status(400).json({ error: 'Status must be one of: active, paused, stopped.' });
      }
      const updated = await userService.updateUserStatus(userId, status as 'active' | 'paused' | 'stopped');
      if (!updated) {
          return res.status(404).json({ error: 'User not found.' });
      }
      res.json({ success: true, status });
  } catch (error: any) {
      console.error('Admin update user status error:', error);
      res.status(500).json({ error: error.message || 'Failed to update status' });
  }
});

// GET /api/admin/support-requests - List support requests with search and status filter
app.get('/api/admin/support-requests', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const pool = getDatabasePool();
      const search = (req.query.search as string) || '';
      const status = (req.query.status as string) || '';
      let query = 'SELECT sr.*, u.email as user_email FROM support_requests sr LEFT JOIN users u ON sr.user_id = u.id WHERE 1=1';
      const params: unknown[] = [];
      let idx = 1;
      if (search.trim()) {
          params.push(`%${search.trim().toLowerCase()}%`);
          query += ` AND (LOWER(sr.email) LIKE $${idx} OR LOWER(COALESCE(sr.name,'')) LIKE $${idx} OR LOWER(COALESCE(sr.subject,'')) LIKE $${idx} OR LOWER(sr.message) LIKE $${idx})`;
          idx++;
      }
      if (status && ['new', 'read', 'replied'].includes(status)) {
          params.push(status);
          query += ` AND sr.status = $${idx}`;
          idx++;
      }
      query += ' ORDER BY sr.created_at DESC LIMIT 500';
      const result = await pool.query(query, params);
      res.json({ success: true, items: result.rows });
  } catch (error: any) {
      console.error('Admin support-requests error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch support requests' });
  }
});

// PATCH /api/admin/support-requests/:id - Update support request status
app.patch('/api/admin/support-requests/:id', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const id = parseInt(req.params.id, 10);
      const { status } = req.body;
      if (!status || !['new', 'read', 'replied'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status. Use new, read, or replied.' });
      }
      const pool = getDatabasePool();
      await pool.query('UPDATE support_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, id]);
      res.json({ success: true, status });
  } catch (error: any) {
      console.error('Admin update support-request error:', error);
      res.status(500).json({ error: error.message || 'Failed to update' });
  }
});

// GET /api/admin/contact-messages - List contact messages with search and status filter
app.get('/api/admin/contact-messages', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const pool = getDatabasePool();
      const search = (req.query.search as string) || '';
      const status = (req.query.status as string) || '';
      let query = 'SELECT * FROM contact_messages WHERE 1=1';
      const params: unknown[] = [];
      let idx = 1;
      if (search.trim()) {
          params.push(`%${search.trim().toLowerCase()}%`);
          query += ` AND (LOWER(email) LIKE $${idx} OR LOWER(COALESCE(name,'')) LIKE $${idx} OR LOWER(COALESCE(subject,'')) LIKE $${idx} OR LOWER(message) LIKE $${idx})`;
          idx++;
      }
      if (status && ['new', 'read', 'replied'].includes(status)) {
          params.push(status);
          query += ` AND status = $${idx}`;
          idx++;
      }
      query += ' ORDER BY created_at DESC LIMIT 500';
      const result = await pool.query(query, params);
      res.json({ success: true, items: result.rows });
  } catch (error: any) {
      console.error('Admin contact-messages error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch contact messages' });
  }
});

// PATCH /api/admin/contact-messages/:id - Update contact message status
app.patch('/api/admin/contact-messages/:id', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const id = parseInt(req.params.id, 10);
      const { status } = req.body;
      if (!status || !['new', 'read', 'replied'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status. Use new, read, or replied.' });
      }
      const pool = getDatabasePool();
      await pool.query('UPDATE contact_messages SET status = $1 WHERE id = $2', [status, id]);
      res.json({ success: true, status });
  } catch (error: any) {
      console.error('Admin update contact-message error:', error);
      res.status(500).json({ error: error.message || 'Failed to update' });
  }
});

// GET /api/admin/demo-requests - List demo requests with search and status filter
app.get('/api/admin/demo-requests', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const pool = getDatabasePool();
      const search = (req.query.search as string) || '';
      const status = (req.query.status as string) || '';
      let query = 'SELECT * FROM demo_requests WHERE 1=1';
      const params: unknown[] = [];
      let idx = 1;
      if (search.trim()) {
          params.push(`%${search.trim().toLowerCase()}%`);
          query += ` AND (LOWER(email) LIKE $${idx} OR LOWER(first_name) LIKE $${idx} OR LOWER(last_name) LIKE $${idx} OR LOWER(company_name) LIKE $${idx})`;
          idx++;
      }
      if (status && ['new', 'read', 'replied'].includes(status)) {
          params.push(status);
          query += ` AND status = $${idx}`;
          idx++;
      }
      query += ' ORDER BY created_at DESC LIMIT 500';
      const result = await pool.query(query, params);
      res.json({ success: true, items: result.rows });
  } catch (error: any) {
      console.error('Admin demo-requests error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch demo requests' });
  }
});

// PATCH /api/admin/demo-requests/:id - Update demo request status
app.patch('/api/admin/demo-requests/:id', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const id = parseInt(req.params.id, 10);
      const { status } = req.body;
      if (!status || !['new', 'read', 'replied'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status. Use new, read, or replied.' });
      }
      const pool = getDatabasePool();
      await pool.query('UPDATE demo_requests SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [status, id]);
      res.json({ success: true, status });
  } catch (error: any) {
      console.error('Admin update demo-request error:', error);
      res.status(500).json({ error: error.message || 'Failed to update' });
  }
});

// GET /api/admin/users-with-plans - List users with subscription and custom limits (admin only)
app.get('/api/admin/users-with-plans', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const pool = getDatabasePool();
      const search = (req.query.search as string) || '';
      let query = `
          SELECT u.id, u.email, u.name,
                 s.plan_name, s.plan_type, s.status AS subscription_status,
                 s.current_period_end, s.extra_users,
                 l.max_users AS limit_max_users, l.max_workspaces AS limit_max_workspaces,
                 l.max_queries_per_month AS limit_max_queries, l.max_tables_per_data_source AS limit_max_tables
          FROM users u
          LEFT JOIN subscriptions s ON s.user_id = u.id
          LEFT JOIN user_plan_limits l ON l.user_id = u.id
          WHERE 1=1
      `;
      const params: unknown[] = [];
      if (search.trim()) {
          params.push(`%${search.trim().toLowerCase()}%`);
          query += ` AND (LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.name,'')) LIKE $${params.length})`;
      }
      query += ' ORDER BY u.created_at DESC LIMIT 500';
      const result = await pool.query(query, params);
      const items = result.rows.map((row: any) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          planName: row.plan_name || 'free',
          planType: row.plan_type || 'monthly',
          subscriptionStatus: row.subscription_status || null,
          currentPeriodEnd: row.current_period_end,
          extraUsers: row.extra_users != null ? Number(row.extra_users) : 0,
          customLimits: row.limit_max_users != null ? {
              maxUsers: Number(row.limit_max_users),
              maxWorkspaces: Number(row.limit_max_workspaces),
              maxQueriesPerMonth: Number(row.limit_max_queries),
              maxTablesPerDataSource: Number(row.limit_max_tables)
          } : null
      }));
      res.json({ success: true, items });
  } catch (error: any) {
      console.error('Admin users-with-plans error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch users with plans' });
  }
});

// POST /api/admin/users/:userId/plan - Set or upgrade a user's plan (admin only)
app.post('/api/admin/users/:userId/plan', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const userId = parseInt(req.params.userId, 10);
      if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
      const { planName, planType } = req.body;
      if (!planName || !['free', 'startpro', 'smartpro', 'enterprise'].includes(planName)) {
          return res.status(400).json({ error: 'Invalid plan name. Use free, startpro, smartpro, or enterprise.' });
      }
      const planTypeVal = (planType === 'annual' ? 'annual' : 'monthly') as PlanType;
      const now = new Date();
      let currentPeriodEnd: Date;
      if (planName === 'free') {
          currentPeriodEnd = new Date(now);
          currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);
      } else if (planTypeVal === 'annual') {
          currentPeriodEnd = new Date(now);
          currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
      } else {
          currentPeriodEnd = new Date(now);
          currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      }
      const subscription = await subscriptionService.createSubscription({
          userId,
          planName: planName as PlanName,
          planType: planTypeVal,
          currentPeriodStart: now,
          currentPeriodEnd
      });
      if (planName === 'free') {
          await subscriptionService.updateSubscriptionStatus(userId, 'trialing');
      }
      res.json({
          success: true,
          message: `Plan set to ${planName} (${planTypeVal}).`,
          subscription: {
              planName: subscription.planName,
              planType: subscription.planType,
              currentPeriodEnd: subscription.currentPeriodEnd
          }
      });
  } catch (error: any) {
      console.error('Admin set user plan error:', error);
      res.status(500).json({ error: error.message || 'Failed to set plan' });
  }
});

// GET /api/admin/user-plan-limits/:userId - Get custom limits for a user (admin only)
app.get('/api/admin/user-plan-limits/:userId', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const userId = parseInt(req.params.userId, 10);
      if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
      const limits = await subscriptionService.getCustomLimitsForUser(userId);
      res.json({ success: true, limits: limits || null });
  } catch (error: any) {
      console.error('Admin get user plan limits error:', error);
      res.status(500).json({ error: error.message || 'Failed to get limits' });
  }
});

// PUT /api/admin/user-plan-limits/:userId - Set custom limits for a user, e.g. Enterprise (admin only)
app.put('/api/admin/user-plan-limits/:userId', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const userId = parseInt(req.params.userId, 10);
      if (isNaN(userId)) return res.status(400).json({ error: 'Invalid user ID' });
      const { maxUsers, maxWorkspaces, maxQueriesPerMonth, maxTablesPerDataSource } = req.body;
      const toNum = (v: any, def: number) => (v === undefined || v === null ? def : parseInt(String(v), 10));
      const limits = {
          maxUsers: toNum(maxUsers, -1),
          maxWorkspaces: toNum(maxWorkspaces, -1),
          maxQueriesPerMonth: toNum(maxQueriesPerMonth, -1),
          maxTablesPerDataSource: toNum(maxTablesPerDataSource, -1)
      };
      if (!Number.isFinite(limits.maxUsers) || !Number.isFinite(limits.maxWorkspaces) ||
          !Number.isFinite(limits.maxQueriesPerMonth) || !Number.isFinite(limits.maxTablesPerDataSource)) {
          return res.status(400).json({ error: 'All limit values must be numbers. Use -1 for unlimited.' });
      }
      await subscriptionService.setCustomLimitsForUser(userId, limits);
      res.json({ success: true, message: 'Custom limits saved.', limits });
  } catch (error: any) {
      console.error('Admin set user plan limits error:', error);
      res.status(500).json({ error: error.message || 'Failed to set limits' });
  }
});

// GET /api/admin/usage - List each account's usage (admin only): queries, workspaces, users, connections, etc.
app.get('/api/admin/usage', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const pool = getDatabasePool();
      const search = (req.query.search as string) || '';
      let query = `
          SELECT u.id, u.email, u.name,
                 s.plan_name, s.current_period_start, s.current_period_end,
                 (SELECT COALESCE(SUM(qu.query_count), 0)::bigint FROM query_usage qu WHERE qu.user_id = u.id) AS total_queries,
                 (SELECT COALESCE(SUM(qu.query_count), 0)::bigint FROM query_usage qu
                  WHERE qu.user_id = u.id
                    AND qu.query_date >= COALESCE((s.current_period_start)::date, date_trunc('month', CURRENT_DATE)::date)
                    AND qu.query_date <= COALESCE((s.current_period_end)::date, (date_trunc('month', CURRENT_DATE) + interval '1 month' - interval '1 day')::date)
                 ) AS period_queries,
                 (SELECT COUNT(*)::int FROM workspaces w WHERE w.owner_id = u.id) AS workspace_count,
                 (SELECT COUNT(DISTINCT uid) FROM (
                    SELECT w.owner_id AS uid FROM workspaces w WHERE w.owner_id = u.id
                    UNION ALL
                    SELECT wm.user_id AS uid FROM workspace_members wm
                    JOIN workspaces w ON w.id = wm.workspace_id WHERE w.owner_id = u.id
                 ) t) AS member_count,
                 (SELECT COUNT(*)::int FROM connection_configs c WHERE c.user_id = u.id) AS connections_count
          FROM users u
          LEFT JOIN subscriptions s ON s.user_id = u.id AND s.status IN ('active', 'trialing')
          WHERE 1=1
      `;
      const params: unknown[] = [];
      if (search.trim()) {
          params.push(`%${search.trim().toLowerCase()}%`);
          query += ` AND (LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.name,'')) LIKE $${params.length})`;
      }
      query += ' ORDER BY u.created_at DESC LIMIT 500';
      const result = await pool.query(query, params);
      const items = result.rows.map((row: any) => ({
          id: row.id,
          email: row.email,
          name: row.name,
          planName: row.plan_name || 'free',
          currentPeriodStart: row.current_period_start,
          currentPeriodEnd: row.current_period_end,
          totalQueries: Number(row.total_queries || 0),
          periodQueries: Number(row.period_queries || 0),
          workspaceCount: Number(row.workspace_count || 0),
          memberCount: Number(row.member_count || 0),
          connectionsCount: Number(row.connections_count || 0)
      }));
      res.json({ success: true, items });
  } catch (error: any) {
      console.error('Admin usage error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch usage' });
  }
});

// GET /api/admin/payments - List all payments with user info (admin only)
app.get('/api/admin/payments', authenticateToken, requireAdmin, async (req: AuthenticatedRequest, res) => {
  try {
      const pool = getDatabasePool();
      const search = (req.query.search as string) || '';
      let query = `
          SELECT p.id, p.user_id, p.amount, p.currency, p.status, p.plan_name, p.plan_type, p.item_type,
                 p.billing_period_start, p.billing_period_end, p.created_at,
                 u.email, u.name
          FROM payments p
          JOIN users u ON u.id = p.user_id
          WHERE 1=1
      `;
      const params: unknown[] = [];
      if (search.trim()) {
          params.push(`%${search.trim().toLowerCase()}%`);
          query += ` AND (LOWER(u.email) LIKE $${params.length} OR LOWER(COALESCE(u.name,'')) LIKE $${params.length})`;
      }
      query += ' ORDER BY p.created_at DESC LIMIT 500';
      const result = await pool.query(query, params);
      const items = result.rows.map((row: any) => ({
          id: row.id,
          userId: row.user_id,
          email: row.email,
          name: row.name,
          amount: parseFloat(row.amount),
          currency: row.currency,
          status: row.status,
          planName: row.plan_name,
          planType: row.plan_type,
          itemType: row.item_type || 'plan',
          billingPeriodStart: row.billing_period_start,
          billingPeriodEnd: row.billing_period_end,
          createdAt: row.created_at
      }));
      res.json({ success: true, items });
  } catch (error: any) {
      console.error('Admin payments error:', error);
      res.status(500).json({ error: error.message || 'Failed to fetch payments' });
  }
});

// POST /api/connections - Save connection config
app.post('/api/connections', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { sourceId, sourceType, config, connectionStatus } = req.body;

      if (!sourceId || !sourceType || !config) {
          return res.status(400).json({ error: 'sourceId, sourceType, and config are required' });
      }

      // Remove _connectionStatus from config before saving (it's metadata)
      const { _connectionStatus, ...cleanConfig } = config;

      const savedConfig = await connectionConfigService.saveConnectionConfig({
          userId: req.userId,
          sourceId,
          sourceType,
          config: cleanConfig,
          connectionStatus: connectionStatus || _connectionStatus
      });

      res.json({ success: true, config: savedConfig });
  } catch (error: any) {
      console.error('Error saving connection config:', error);
      res.status(500).json({ error: 'Failed to save connection config' });
  }
});

// DELETE /api/connections/:sourceId - Delete connection config
app.delete('/api/connections/:sourceId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { sourceId } = req.params;
      const deleted = await connectionConfigService.deleteConnectionConfig(req.userId, sourceId);

      if (deleted) {
          res.json({ success: true, message: 'Connection config deleted successfully' });
      } else {
          res.status(404).json({ error: 'Connection config not found' });
      }
  } catch (error: any) {
      console.error('Error deleting connection config:', error);
      res.status(500).json({ error: 'Failed to delete connection config' });
  }
});

// PUT /api/connections/:sourceId/status - Update connection status
app.put('/api/connections/:sourceId/status', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { sourceId } = req.params;
      const { status } = req.body;

      if (!status || !['connected', 'failed', 'untested'].includes(status)) {
          return res.status(400).json({ error: 'Valid status is required (connected, failed, or untested)' });
      }

      const updated = await connectionConfigService.updateConnectionStatus(
          req.userId,
          sourceId,
          status
      );

      if (updated) {
          res.json({ success: true, message: 'Connection status updated' });
      } else {
          res.status(404).json({ error: 'Connection config not found' });
      }
  } catch (error: any) {
      console.error('Error updating connection status:', error);
      res.status(500).json({ error: 'Failed to update connection status' });
  }
});

// Third-Party Connections API

// GET /api/third-party/slack - Get Slack configuration
app.get('/api/third-party/slack', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const config = await thirdPartyService.getThirdPartyConfig(req.userId, 'slack');
      
      if (!config) {
          return res.json({ success: true, config: null });
      }

      res.json({ success: true, config: config.config });
  } catch (error: any) {
      console.error('Error getting Slack config:', error);
      res.status(500).json({ error: 'Failed to get Slack configuration' });
  }
});

// POST /api/third-party/slack - Save Slack configuration
app.post('/api/third-party/slack', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { apiToken, verificationToken, signingSecret } = req.body;

      // Slack's current Events API flow uses signing secret; verification token is legacy/optional.
      if (!apiToken || !signingSecret) {
          return res.status(400).json({ error: 'apiToken and signingSecret are required' });
      }

      let teamId: string | undefined;
      try {
          const authTest = await axios.post('https://slack.com/api/auth.test', {}, {
              headers: {
                  'Authorization': `Bearer ${apiToken.trim()}`,
                  'Content-Type': 'application/json'
              }
          });
          if (authTest.data && authTest.data.ok && authTest.data.team_id) {
              teamId = authTest.data.team_id;
          }
      } catch (error) {
          console.warn('⚠️ Could not fetch Slack team_id via auth.test');
      }

      const savedConfig = await thirdPartyService.saveThirdPartyConfig({
          userId: req.userId,
          serviceType: 'slack',
          config: {
              apiToken: apiToken.trim(),
              verificationToken: typeof verificationToken === 'string' && verificationToken.trim() !== ''
                  ? verificationToken.trim()
                  : undefined,
              signingSecret: signingSecret.trim(),
              teamId
          }
      });

      console.log(
        `✅ Slack config saved for user ${req.userId} (teamId=${teamId || 'unknown'}, hasVerificationToken=${!!savedConfig.config.verificationToken})`
      );
      try {
        const pool = getDatabasePool();
        const verify = await pool.query(
          `SELECT COUNT(*)::int AS c
           FROM public.third_party_connections
           WHERE user_id = $1 AND service_type = 'slack'`,
          [req.userId]
        );
        const dbName = await pool.query('SELECT current_database() AS db');
        console.log(
          `🔎 Post-save verify: db=${dbName.rows[0]?.db || 'unknown'} public.third_party_connections(user=${req.userId},slack)=${verify.rows[0]?.c ?? 0}`
        );
      } catch (verifyErr) {
        console.warn('⚠️ Slack post-save verification query failed:', verifyErr);
      }

      res.json({ success: true, config: savedConfig.config });
  } catch (error: any) {
      console.error('Error saving Slack config:', error);
      res.status(500).json({ error: 'Failed to save Slack configuration' });
  }
});

// POST /api/third-party/slack/test - Test Slack connection
app.post('/api/third-party/slack/test', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      // Try to get API token from request body first (for testing before saving)
      // Otherwise, get from saved configuration
      let apiToken: string | undefined;
      
      if (req.body.apiToken) {
          // Use token from request body (user is testing before saving)
          apiToken = req.body.apiToken.trim();
      } else {
          // Try to get from saved configuration
          const config = await thirdPartyService.getThirdPartyConfig(req.userId, 'slack');
          if (config && config.config.apiToken) {
              apiToken = config.config.apiToken;
          }
      }

      if (!apiToken) {
          return res.status(400).json({ 
              success: false,
              error: 'Slack API token is required. Please provide an API token or configure Slack first.' 
          });
      }

      // Test the Slack API token by calling auth.test
      try {
          const testResponse = await axios.post('https://slack.com/api/auth.test', {}, {
              headers: {
                  'Authorization': `Bearer ${apiToken}`,
                  'Content-Type': 'application/json'
              }
          });

          if (testResponse.data && testResponse.data.ok) {
              res.json({ 
                  success: true, 
                  message: 'Slack connection test successful',
                  botInfo: {
                      team: testResponse.data.team,
                      user: testResponse.data.user,
                      botId: testResponse.data.user_id
                  }
              });
          } else {
              res.status(400).json({ 
                  success: false,
                  error: testResponse.data.error || 'Slack API test failed' 
              });
          }
      } catch (testError: any) {
          res.status(400).json({ 
              success: false,
              error: testError.response?.data?.error || testError.message || 'Failed to test Slack connection' 
          });
      }
  } catch (error: any) {
      console.error('Error testing Slack connection:', error);
      res.status(500).json({ error: 'Failed to test Slack connection' });
  }
});

// POST /api/third-party/slack/cleanup-files - Delete old uploaded data files from Slack
app.post('/api/third-party/slack/cleanup-files', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const slackConfig = await thirdPartyService.getThirdPartyConfig(req.userId, 'slack');
      const apiToken = slackConfig?.config?.apiToken?.trim();
      if (!apiToken) {
          return res.status(400).json({ error: 'Slack API token is not configured.' });
      }

      const rawDays = Number(req.body?.olderThanDays);
      const olderThanDays =
          Number.isFinite(rawDays) && rawDays > 0
              ? Math.min(365, Math.floor(rawDays))
              : 3;
      const tsTo = Math.floor(Date.now() / 1000) - olderThanDays * 24 * 60 * 60;

      const isDataLikeFileName = (name: string): boolean =>
          /\.(csv|tsv|xlsx|xls|json|txt)$/i.test(name);

      const filesToDelete: Array<{ id: string; name: string; created: number }> = [];
      const maxPages = 20;
      const perPage = 100;

      for (let page = 1; page <= maxPages; page++) {
          const listResp = await axios.get('https://slack.com/api/files.list', {
              headers: {
                  'Authorization': `Bearer ${apiToken}`,
              },
              params: {
                  count: perPage,
                  page,
                  ts_to: tsTo,
              },
          });

          if (!listResp.data?.ok) {
              return res.status(400).json({
                  error: listResp.data?.error || 'Failed to list Slack files',
              });
          }

          const files = Array.isArray(listResp.data.files) ? listResp.data.files : [];
          for (const f of files) {
              const id = String(f?.id || '');
              const name = String(f?.name || '');
              const created = Number(f?.created || 0);
              if (!id || !name || !created) continue;
              if (!isDataLikeFileName(name)) continue;
              filesToDelete.push({ id, name, created });
          }

          const paging = listResp.data?.paging;
          const pages = Number(paging?.pages || 1);
          if (page >= pages) break;
      }

      let deletedCount = 0;
      const failed: Array<{ id: string; name: string; error: string }> = [];
      for (const f of filesToDelete) {
          try {
              const delResp = await axios.post(
                  'https://slack.com/api/files.delete',
                  { file: f.id },
                  {
                      headers: {
                          'Authorization': `Bearer ${apiToken}`,
                          'Content-Type': 'application/json',
                      },
                  }
              );
              if (delResp.data?.ok) {
                  deletedCount += 1;
              } else {
                  failed.push({ id: f.id, name: f.name, error: String(delResp.data?.error || 'delete_failed') });
              }
          } catch (err: any) {
              failed.push({ id: f.id, name: f.name, error: err?.message || 'delete_failed' });
          }
      }

      return res.json({
          success: true,
          olderThanDays,
          foundCount: filesToDelete.length,
          deletedCount,
          failedCount: failed.length,
          failed: failed.slice(0, 20),
      });
  } catch (error: any) {
      console.error('Error cleaning up old Slack files:', error);
      return res.status(500).json({ error: error?.message || 'Failed to clean up Slack files' });
  }
});

// DELETE /api/third-party/slack - Delete Slack configuration
app.delete('/api/third-party/slack', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const deleted = await thirdPartyService.deleteThirdPartyConfig(req.userId, 'slack', {
          source: 'api:DELETE /api/third-party/slack',
          detail: 'User disconnected Slack via Community Channels UI',
      });

      if (deleted) {
          res.json({ success: true, message: 'Slack configuration deleted successfully' });
      } else {
          res.status(404).json({ error: 'Slack configuration not found' });
      }
  } catch (error: any) {
      console.error('Error deleting Slack config:', error);
      res.status(500).json({ error: 'Failed to delete Slack configuration' });
  }
});

// GET /api/third-party/teams - Get Teams configuration
app.get('/api/third-party/teams', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const config = await thirdPartyService.getThirdPartyConfig(req.userId, 'teams');
      
      if (!config) {
          return res.json({ success: true, config: null });
      }

      res.json({ success: true, config: config.config });
  } catch (error: any) {
      console.error('Error getting Teams config:', error);
      res.status(500).json({ error: 'Failed to get Teams configuration' });
  }
});

// POST /api/third-party/teams - Save Teams configuration
app.post('/api/third-party/teams', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { appId, clientSecret, botTokenEndpoint, webhookUrl, tenantId } = req.body;

      if (!appId || !clientSecret) {
          return res.status(400).json({ error: 'appId and clientSecret are required' });
      }

      const savedConfig = await thirdPartyService.saveThirdPartyConfig({
          userId: req.userId,
          serviceType: 'teams',
          config: {
              appId: appId.trim(),
              clientSecret: clientSecret.trim(),
              botTokenEndpoint: botTokenEndpoint?.trim(),
              webhookUrl: webhookUrl?.trim(),
              tenantId: tenantId?.trim()
          }
      });

      res.json({ success: true, config: savedConfig.config });
  } catch (error: any) {
      console.error('Error saving Teams config:', error);
      res.status(500).json({ error: 'Failed to save Teams configuration' });
  }
});

// POST /api/third-party/teams/test - Test Teams connection
app.post('/api/third-party/teams/test', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      // Try to get credentials from request body first (for testing before saving)
      // Otherwise, get from saved configuration
      let appId: string | undefined;
      let clientSecret: string | undefined;
      
      if (req.body.appId && req.body.clientSecret) {
          // Use credentials from request body (user is testing before saving)
          appId = req.body.appId.trim();
          clientSecret = req.body.clientSecret.trim();
      } else {
          // Try to get from saved configuration
          const config = await thirdPartyService.getThirdPartyConfig(req.userId, 'teams');
          if (config && config.config.appId && config.config.clientSecret) {
              appId = config.config.appId;
              clientSecret = config.config.clientSecret;
          }
      }

      if (!appId || !clientSecret) {
          return res.status(400).json({ 
              success: false,
              error: 'Microsoft App ID and Client Secret are required. Please provide credentials or configure Teams first.' 
          });
      }

      // Test the Teams credentials by getting an OAuth token
      // For Teams Bot Framework, apps are registered in Azure AD (not Bot Framework directory)
      // We use the common endpoint or tenant-specific endpoint with Bot Framework scope
      try {
          // Use common endpoint (works for apps registered in any Azure AD tenant)
          // The scope is for Bot Framework API, but the app is registered in regular Azure AD
          const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
          const params = new URLSearchParams({
              client_id: appId,
              client_secret: clientSecret,
              scope: 'https://api.botframework.com/.default',
              grant_type: 'client_credentials'
          });

          const testResponse = await axios.post(tokenUrl, params.toString(), {
              headers: {
                  'Content-Type': 'application/x-www-form-urlencoded'
              },
              timeout: 10000
          });

          if (testResponse.data && testResponse.data.access_token) {
              // Successfully got access token, connection is valid
              res.json({ 
                  success: true, 
                  appInfo: {
                      name: 'Microsoft Teams App',
                      appId: appId
                  }
              });
          } else {
              res.json({ 
                  success: false,
                  error: 'Failed to authenticate with Microsoft. Please check your App ID and Client Secret.' 
              });
          }
      } catch (testError: any) {
          console.error('Teams authentication test error:', testError);
          if (testError.response && testError.response.data) {
              const errorData = testError.response.data;
              let errorMessage = errorData.error_description || errorData.error || 'Authentication failed';
              
              // Provide more helpful error messages for common issues
              if (errorData.error === 'invalid_client') {
                  errorMessage = 'Invalid App ID or Client Secret. Please verify your credentials.';
              } else if (errorData.error === 'invalid_grant') {
                  if (errorMessage.includes('Conditional Access')) {
                      errorMessage = 'Access blocked by Conditional Access policies. Please contact your administrator or check your Azure AD settings.';
                  } else {
                      errorMessage = 'Authentication failed. Please verify your App ID and Client Secret are correct.';
                  }
              } else if (errorData.error === 'unauthorized_client') {
                  errorMessage = 'The application is not authorized. Please check your Azure AD app registration permissions.';
              }
              
              res.json({ 
                  success: false,
                  error: `Teams authentication failed: ${errorMessage}` 
              });
          } else {
              res.json({ 
                  success: false,
                  error: `Teams authentication failed: ${testError.message || 'Unknown error'}` 
              });
          }
      }
  } catch (error: any) {
      console.error('Error testing Teams connection:', error);
      res.status(500).json({ error: 'Failed to test Teams connection' });
  }
});

// DELETE /api/third-party/teams - Delete Teams configuration
app.delete('/api/third-party/teams', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const deleted = await thirdPartyService.deleteThirdPartyConfig(req.userId, 'teams', {
          source: 'api:DELETE /api/third-party/teams',
          detail: 'User disconnected Teams via Community Channels UI',
      });

      if (deleted) {
          res.json({ success: true, message: 'Teams configuration deleted successfully' });
      } else {
          res.status(404).json({ error: 'Teams configuration not found' });
      }
  } catch (error: any) {
      console.error('Error deleting Teams config:', error);
      res.status(500).json({ error: 'Failed to delete Teams configuration' });
  }
});

// POST /api/teams/events - Handle Teams Bot Framework events
app.post('/api/teams/events', express.json(), async (req, res) => {
  try {
      const activity = req.body;
      
      // Handle Teams verification challenge
      if (activity.type === 'invoke' && activity.name === 'ping') {
          return res.status(200).json({});
      }

      // Handle message activities
      if (activity.type === 'message') {
          // Get API base URL
          const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${PORT}`;
          
          // Find user by Teams conversation ID or other identifier
          // For now, we'll need to match Teams user to our user database
          // This is a simplified version - in production, you'd need proper user mapping
          const users = await userService.getAllUsers();
          
          const activityTenantId = activity?.channelData?.tenant?.id;
          // Try to find a user with Teams config (prefer tenantId match)
          let matchedUser = null;
          let fallbackUser = null;
          for (const user of users) {
              const teamsConfig = await thirdPartyService.getThirdPartyConfig(user.id, 'teams');
              if (teamsConfig && teamsConfig.config.appId) {
                  if (teamsConfig.config.tenantId && activityTenantId) {
                      if (teamsConfig.config.tenantId === activityTenantId) {
                          matchedUser = user;
                          break;
                      }
                  } else if (!teamsConfig.config.tenantId) {
                      fallbackUser = fallbackUser || user;
                  }
              }
          }

          if (!matchedUser && fallbackUser) {
              matchedUser = fallbackUser;
          }

          if (!matchedUser) {
              console.warn('⚠️ No user found with Teams configuration');
              return res.status(200).send('');
          }

          // Process the Teams activity
          let processTeamsActivity: ((activity: any, userId: number, apiBaseUrl: string) => Promise<any>) | undefined;
          try {
              const teamsModulePath = './services/microsoft-teams/teams-handler';
              const teamsModule = await import(teamsModulePath);
              processTeamsActivity = teamsModule.processTeamsActivity as typeof processTeamsActivity;
          } catch {
              console.warn('⚠️ Teams handler module not available; skipping Teams activity processing');
              return res.status(200).send('');
          }
          if (!processTeamsActivity) {
              return res.status(200).send('');
          }
          const response = await processTeamsActivity(activity, matchedUser.id, apiBaseUrl);

          if (response.text || response.attachments) {
              // Send response back to Teams
              const teamsConfig = await thirdPartyService.getThirdPartyConfig(matchedUser.id, 'teams');
              if (teamsConfig && teamsConfig.config.appId && teamsConfig.config.clientSecret) {
                  // Get access token using common endpoint (apps are registered in Azure AD, not Bot Framework directory)
                  const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
                  const params = new URLSearchParams({
                      client_id: teamsConfig.config.appId,
                      client_secret: teamsConfig.config.clientSecret,
                      scope: 'https://api.botframework.com/.default',
                      grant_type: 'client_credentials'
                  });

                  const tokenResponse = await axios.post(tokenUrl, params.toString(), {
                      headers: {
                          'Content-Type': 'application/x-www-form-urlencoded'
                      }
                  });

                  if (tokenResponse.data && tokenResponse.data.access_token) {
                      const accessToken = tokenResponse.data.access_token;
                      const serviceUrl = activity.serviceUrl;
                      const conversationId = activity.conversation?.id;

                      if (serviceUrl && conversationId) {
                          // Send message to Teams
                          await axios.post(
                              `${serviceUrl}/v3/conversations/${conversationId}/activities`,
                              {
                                  type: 'message',
                                  text: response.text,
                                  attachments: response.attachments
                              },
                              {
                                  headers: {
                                      'Authorization': `Bearer ${accessToken}`,
                                      'Content-Type': 'application/json'
                                  }
                              }
                          );
                      }
                  }
              }
          }

          return res.status(200).send('');
      }

      res.status(200).send('');
  } catch (error: any) {
      console.error('❌ Error handling Teams event:', error);
      res.status(200).send(''); // Always return 200 to Teams
  }
});

// POST /api/teams/interactive - Handle Teams Adaptive Card interactions
app.post('/api/teams/interactive', express.json(), async (req, res) => {
  try {
      const payload = req.body;
      
      // ✅ BEST PRACTICE: Acknowledge immediately to avoid timeout
      res.status(200).send('');
      
      // ✅ Process interaction asynchronously in background
      (async () => {
          try {
              let handleTeamsInteraction: ((payload: any) => Promise<any>) | undefined;
              try {
                  const teamsInteractionsPath = './services/microsoft-teams/teams_interactions';
                  const teamsInteractionsModule = await import(teamsInteractionsPath);
                  handleTeamsInteraction = teamsInteractionsModule.handleTeamsInteraction as typeof handleTeamsInteraction;
              } catch {
                  console.warn('⚠️ Teams interactions module not available; skipping Teams interaction processing');
                  return;
              }
              if (!handleTeamsInteraction) {
                  return;
              }
              const result = await handleTeamsInteraction(payload);

              if (result && result.card) {
                  // Get Teams config to send update
                  const action = payload.action || payload.data?.action;
                  const responseId = payload.responseId || payload.data?.responseId;
                  
                  if (responseId) {
                      const responseCache = (global as any).teamsResponseCache;
                      const cachedData = responseCache?.get(responseId);
                      
                      if (cachedData && cachedData.conversationId) {
                          const teamsConfig = await thirdPartyService.getThirdPartyConfig(cachedData.userId, 'teams');
                          if (teamsConfig && teamsConfig.config.appId && teamsConfig.config.clientSecret) {
                              // Get access token using common endpoint (apps are registered in Azure AD, not Bot Framework directory)
                              const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
                              const params = new URLSearchParams({
                                  client_id: teamsConfig.config.appId,
                                  client_secret: teamsConfig.config.clientSecret,
                                  scope: 'https://api.botframework.com/.default',
                                  grant_type: 'client_credentials'
                              });

                              const tokenResponse = await axios.post(tokenUrl, params.toString(), {
                                  headers: {
                                      'Content-Type': 'application/x-www-form-urlencoded'
                                  }
                              });

                              if (tokenResponse.data && tokenResponse.data.access_token) {
                                  const accessToken = tokenResponse.data.access_token;
                                  const serviceUrl = payload.serviceUrl || cachedData.serviceUrl;
                                  const conversationId = cachedData.conversationId;
                                  const activityId = cachedData.activityId;

                                  if (serviceUrl && conversationId) {
                                      if (result.updateMessage && activityId) {
                                          // Update the original message
                                          await axios.put(
                                              `${serviceUrl}/v3/conversations/${conversationId}/activities/${activityId}`,
                                              {
                                                  type: 'message',
                                                  text: 'Query Results',
                                                  attachments: [{
                                                      contentType: 'application/vnd.microsoft.card.adaptive',
                                                      content: result.card
                                                  }]
                                              },
                                              {
                                                  headers: {
                                                      'Authorization': `Bearer ${accessToken}`,
                                                      'Content-Type': 'application/json'
                                                  }
                                              }
                                          );
                                      } else {
                                          // Post as new message
                                          await axios.post(
                                              `${serviceUrl}/v3/conversations/${conversationId}/activities`,
                                              {
                                                  type: 'message',
                                                  text: 'Query Results',
                                                  attachments: [{
                                                      contentType: 'application/vnd.microsoft.card.adaptive',
                                                      content: result.card
                                                  }]
                                              },
                                              {
                                                  headers: {
                                                      'Authorization': `Bearer ${accessToken}`,
                                                      'Content-Type': 'application/json'
                                                  }
                                              }
                                          );
                                      }
                                  }
                              }
                          }
                      }
                  }
              }
          } catch (asyncError: any) {
              console.error('❌ Error processing Teams interaction:', asyncError);
          }
      })();
  } catch (error: any) {
      console.error('❌ Error handling Teams interaction:', error);
      res.status(200).send(''); // Always return 200 to Teams
  }
});

// Member Management API

// GET /api/members - Get all team members
app.get('/api/members', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      // Use current user's ID as team ID (each user is their own team)
      const members = await memberService.getTeamMembers(req.userId);
      
      res.json({ success: true, members });
  } catch (error: any) {
      console.error('Error getting team members:', error);
      res.status(500).json({ error: 'Failed to get team members' });
  }
});

// POST /api/members/invite - Invite a member to the team
app.post('/api/members/invite', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { email, role } = req.body;

      if (!email || !role) {
          return res.status(400).json({ error: 'Email and role are required' });
      }

      // Check user limit before inviting
      try {
          const currentMembers = await memberService.getTeamMembers(req.userId);
          const currentUserCount = currentMembers.length + 1; // +1 for the team owner
          const userLimit = await subscriptionService.checkUserLimit(req.userId, currentUserCount);
          
          if (!userLimit.allowed) {
              return res.status(403).json({
                  error: 'User limit exceeded',
                  message: `You have reached your plan's user limit of ${userLimit.limit}. Please upgrade your plan to add more users.`,
                  limit: userLimit.limit,
                  current: currentUserCount,
                  upgradeUrl: '/pricing'
              });
          }
      } catch (error) {
          console.warn('Error checking user limit:', error);
          // Continue if limit check fails
      }

      if (role !== 'admin' && role !== 'view') {
          return res.status(400).json({ error: 'Role must be "admin" or "view"' });
      }

      // Check if current user is admin
      const hasPermission = await memberService.hasPermission(req.userId, req.userId, 'configure');
      if (!hasPermission) {
          return res.status(403).json({ error: 'Only admins can invite members' });
      }

      const result = await memberService.inviteMember(req.userId, email, role, req.userId);
      
      if (result.success) {
          res.json({ success: true, message: result.message, userId: result.userId });
      } else {
          res.status(400).json({ success: false, error: result.message });
      }
  } catch (error: any) {
      console.error('Error inviting member:', error);
      res.status(500).json({ error: 'Failed to invite member' });
  }
});

// PUT /api/members/:userId/role - Update member role
app.put('/api/members/:userId/role', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = req.params;
      const { role } = req.body;

      if (!role || (role !== 'admin' && role !== 'view')) {
          return res.status(400).json({ error: 'Valid role (admin or view) is required' });
      }

      // Check if current user is admin
      const hasPermission = await memberService.hasPermission(req.userId, req.userId, 'configure');
      if (!hasPermission) {
          return res.status(403).json({ error: 'Only admins can update member roles' });
      }

      const result = await memberService.updateMemberRole(
          req.userId,
          parseInt(userId, 10),
          role,
          req.userId
      );
      
      if (result.success) {
          res.json({ success: true, message: result.message });
      } else {
          res.status(400).json({ success: false, error: result.message });
      }
  } catch (error: any) {
      console.error('Error updating member role:', error);
      res.status(500).json({ error: 'Failed to update member role' });
  }
});

// DELETE /api/members/:userId - Remove member from team
app.delete('/api/members/:userId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { userId } = req.params;

      // Check if current user is admin
      const hasPermission = await memberService.hasPermission(req.userId, req.userId, 'configure');
      if (!hasPermission) {
          return res.status(403).json({ error: 'Only admins can remove members' });
      }

      const result = await memberService.removeMember(
          req.userId,
          parseInt(userId, 10),
          req.userId
      );
      
      if (result.success) {
          res.json({ success: true, message: result.message });
      } else {
          res.status(400).json({ success: false, error: result.message });
      }
  } catch (error: any) {
      console.error('Error removing member:', error);
      res.status(500).json({ error: 'Failed to remove member' });
  }
});

// GET /api/members/permissions - Check user permissions
app.get('/api/members/permissions', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { action } = req.query;
      
      if (action !== 'configure' && action !== 'query') {
          return res.status(400).json({ error: 'Valid action (configure or query) is required' });
      }

      const hasPermission = await memberService.hasPermission(
          req.userId,
          req.userId,
          action as 'configure' | 'query'
      );
      
      res.json({ success: true, hasPermission });
  } catch (error: any) {
      console.error('Error checking permissions:', error);
      res.status(500).json({ error: 'Failed to check permissions' });
  }
});

// POST /api/members/invite-link - Generate an invite link
app.post('/api/members/invite-link', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { role } = req.body;

      if (!role || (role !== 'admin' && role !== 'view')) {
          return res.status(400).json({ error: 'Valid role (admin or view) is required' });
      }

      // Check if current user is admin
      const hasPermission = await memberService.hasPermission(req.userId, req.userId, 'configure');
      if (!hasPermission) {
          return res.status(403).json({ error: 'Only admins can generate invite links' });
      }

      const result = await memberService.generateInviteToken(req.userId, role, req.userId);
      
      if (result.success && result.token) {
          res.json({ success: true, token: result.token });
      } else {
          res.status(400).json({ success: false, error: result.error || 'Failed to generate invite link' });
      }
  } catch (error: any) {
      console.error('Error generating invite link:', error);
      res.status(500).json({ error: 'Failed to generate invite link' });
  }
});

// POST /api/members/accept-invite - Accept an invite using a token
app.post('/api/members/accept-invite', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { token } = req.body;

      if (!token) {
          return res.status(400).json({ error: 'Invite token is required' });
      }

      const result = await memberService.useInviteToken(token, req.userId);
      
      if (result.success) {
          res.json({ 
              success: true, 
              message: 'Successfully joined the team',
              teamId: result.teamId,
              role: result.role
          });
      } else {
          res.status(400).json({ success: false, error: result.error || 'Failed to accept invite' });
      }
  } catch (error: any) {
      console.error('Error accepting invite:', error);
      res.status(500).json({ error: 'Failed to accept invite' });
  }
});

// Workspace Management API

// GET /api/workspaces - List workspaces for current user
app.get('/api/workspaces', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const workspaces = await workspaceService.listWorkspacesForUser(req.userId);
      const sanitized = workspaces.map(({ config, ...rest }) => rest);
      res.json({ success: true, workspaces: sanitized });
  } catch (error: any) {
      console.error('Error getting workspaces:', error);
      res.status(500).json({ error: 'Failed to get workspaces' });
  }
});

// GET /api/workspaces/:id - Get workspace details
app.get('/api/workspaces/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const workspaceId = parseInt(req.params.id, 10);
      if (Number.isNaN(workspaceId)) {
          return res.status(400).json({ error: 'Invalid workspace id' });
      }

      const workspace = await workspaceService.getWorkspaceById(workspaceId, req.userId);
      if (!workspace) {
          return res.status(404).json({ error: 'Workspace not found' });
      }

      const members = await workspaceService.getWorkspaceMembers(workspaceId);
      const { config, ...sanitized } = workspace;
      res.json({ success: true, workspace: sanitized, members });
  } catch (error: any) {
      console.error('Error getting workspace:', error);
      res.status(500).json({ error: 'Failed to get workspace' });
  }
});

// POST /api/workspaces - Create a workspace
app.post('/api/workspaces', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { name, description, memberIds, memberRoles, includeConfig } = req.body;
      if (!name || typeof name !== 'string') {
          return res.status(400).json({ error: 'Workspace name is required' });
      }

      // Check workspace limit
      try {
          const existingWorkspaces = await workspaceService.listWorkspacesForUser(req.userId);
          const currentWorkspaceCount = existingWorkspaces.length;
          
          const workspaceLimitCheck = await subscriptionService.checkWorkspaceLimit(req.userId, currentWorkspaceCount);
          
          if (!workspaceLimitCheck.allowed) {
              return res.status(403).json({
                  error: 'Workspace limit exceeded',
                  message: `You have reached your plan's workspace limit of ${workspaceLimitCheck.limit}. Current: ${currentWorkspaceCount}. Please upgrade your plan to create more workspaces.`,
                  limit: workspaceLimitCheck.limit,
                  current: currentWorkspaceCount,
                  upgradeUrl: '/pricing'
              });
          }
      } catch (error) {
          console.warn('Error checking workspace limit:', error);
          // Continue if limit check fails (don't block creation due to limit check errors)
      }

      const workspace = await workspaceService.createWorkspace({
          ownerId: req.userId,
          name: name.trim(),
          description,
          memberIds: Array.isArray(memberIds) ? memberIds : [],
          memberRoles: memberRoles && typeof memberRoles === 'object' ? memberRoles : undefined,
          includeConfig: includeConfig === true
      });

      const members = await workspaceService.getWorkspaceMembers(workspace.id);
      const { config, ...sanitized } = workspace;
      res.json({ success: true, workspace: sanitized, members });
  } catch (error: any) {
      console.error('Error creating workspace:', error);
      res.status(500).json({ error: 'Failed to create workspace' });
  }
});

// PUT /api/workspaces/:id - Update a workspace
app.put('/api/workspaces/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const workspaceId = parseInt(req.params.id, 10);
      if (Number.isNaN(workspaceId)) {
          return res.status(400).json({ error: 'Invalid workspace id' });
      }

      const { name, description, memberIds, memberRoles, includeConfig } = req.body;
      const workspace = await workspaceService.updateWorkspace({
          workspaceId,
          ownerId: req.userId,
          name,
          description,
          memberIds: Array.isArray(memberIds) ? memberIds : undefined,
          memberRoles: memberRoles && typeof memberRoles === 'object' ? memberRoles : undefined,
          includeConfig: includeConfig === true
      });

      if (!workspace) {
          return res.status(404).json({ error: 'Workspace not found or access denied' });
      }

      const members = await workspaceService.getWorkspaceMembers(workspaceId);
      const { config, ...sanitized } = workspace;
      res.json({ success: true, workspace: sanitized, members });
  } catch (error: any) {
      console.error('Error updating workspace:', error);
      res.status(500).json({ error: 'Failed to update workspace' });
  }
});

// POST /api/workspaces/:id/activate - Apply workspace config to user
app.post('/api/workspaces/:id/activate', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const workspaceId = parseInt(req.params.id, 10);
      if (Number.isNaN(workspaceId)) {
          return res.status(400).json({ error: 'Invalid workspace id' });
      }

      const workspace = await workspaceService.activateWorkspace(req.userId, workspaceId);
      if (!workspace) {
          return res.status(404).json({ error: 'Workspace not found or access denied' });
      }

      const { config, ...sanitized } = workspace;
      res.json({ success: true, workspace: sanitized });
  } catch (error: any) {
      console.error('Error activating workspace:', error);
      res.status(500).json({ error: 'Failed to activate workspace' });
  }
});

// DELETE /api/workspaces/:id - Delete a workspace
app.delete('/api/workspaces/:id', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const workspaceId = parseInt(req.params.id, 10);
      if (Number.isNaN(workspaceId)) {
          return res.status(400).json({ error: 'Invalid workspace id' });
      }

      const deleted = await workspaceService.deleteWorkspace(workspaceId, req.userId);
      if (!deleted) {
          return res.status(404).json({ error: 'Workspace not found or access denied' });
      }

      res.json({ success: true, message: 'Workspace deleted' });
  } catch (error: any) {
      console.error('Error deleting workspace:', error);
      res.status(500).json({ error: 'Failed to delete workspace' });
  }
});

// Database init is awaited inside app.listen (before Slack checks) to avoid racing migrations.

/** Quick startup sanity check: key table row counts in the active database. */
async function logDatabaseSanitySummary() {
  try {
    const pool = getDatabasePool();
    const tableNames = [
      'users',
      'connection_configs',
      'third_party_connections',
      'llm_settings',
      'chat_sessions',
      'chat_history',
      'workspaces',
    ];

    console.log(`\n   ─ Database Sanity ─`);
    for (const table of tableNames) {
      const result = await pool.query(`SELECT COUNT(*)::int AS count FROM public.${table}`);
      const count = Number(result.rows[0]?.count ?? 0);
      console.log(`   • ${table}: ${count}`);
    }
  } catch (error: unknown) {
    const err = error as { code?: string };
    if (err?.code === '42P01') {
      console.warn('   ⚠️ Database sanity check skipped: one or more tables not ready yet.');
      return;
    }
    console.warn('   ⚠️ Database sanity check failed:', error);
  }
}

/** Log Knowledge Base (RAG) index files per user at startup */
async function logRagStartupSummary() {
  try {
    const users = await userService.getAllUsers();
    console.log(`\n   ─ Knowledge Base (RAG) ─`);
    let anyIndexes = false;
    for (const user of users) {
      const indexes = (await getAllRAGIndexes(user.id)) as Array<Record<string, unknown>>;
      if (indexes.length === 0) continue;
      anyIndexes = true;
      const who = user.email || user.name || `user ${user.id}`;
      console.log(`   • ${who} (id ${user.id}): ${indexes.length} index file(s)`);
      for (const idx of indexes) {
        const id = String(idx.id ?? '?');
        const ds = String(idx.dataSourceType ?? 'unknown');
        let target = '—';
        if (idx.projectId != null && String(idx.projectId).trim() !== '') {
          target = `projectId=${idx.projectId}`;
        } else if (idx.baseId != null && String(idx.baseId).trim() !== '') {
          target = `baseId=${idx.baseId}`;
        } else if (idx.database != null && String(idx.database).trim() !== '') {
          target = `database=${idx.database}`;
        }
        const tables = Array.isArray(idx.tables) ? (idx.tables as unknown[]).length : 0;
        const qa = Array.isArray(idx.questions) ? (idx.questions as unknown[]).length : 0;
        const fp = idx.filePath ? String(idx.filePath).split(/[/\\]/).pop() : '';
        console.log(
          `      – [${ds}] id=${id} ${target} | tables=${tables} Q&A=${qa}${fp ? ` | ${fp}` : ''}`
        );
      }
    }
    if (!anyIndexes) {
      console.log(`   (no RAG / Knowledge Base JSON files found under user rag directories)`);
    }
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    if (err?.code === '42P01') {
      console.warn('   ⚠️ RAG summary skipped: database schema not ready.');
      return;
    }
    console.warn('   ⚠️ Could not list RAG indexes:', error);
  }
}

// Initialize Slack services (call only after initializeDatabase() has completed)
async function initializeSlackServices() {
  try {
      console.log(`\n   ─ Slack ─`);
      if (slackApp) {
          console.log(`   • Optional Bolt app (/slack/events, /sql command): enabled (SLACK_BOT_TOKEN + SLACK_SIGNING_SECRET)`);
      } else {
          console.log(`   • Optional Bolt app (/slack/events, /sql): not loaded — set SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET if you want slash commands on this server`);
          console.log(`   • App UI “Slack” settings use per-user tokens → Events/Interactivity URLs below (no env bot token required)`);
      }

      const users = await userService.getAllUsers();
      let slackConfigCount = 0;

      for (const user of users) {
          const slackConfig = await getSlackConfigForUser(user.id);
          if (slackConfig && slackConfig.config.apiToken && slackConfig.config.signingSecret) {
              slackConfigCount++;
              console.log(`   ✅ Per-user Slack: ${user.email || user.name || `ID ${user.id}`} (user id ${user.id})`);
          }
      }

      if (slackConfigCount > 0) {
          console.log(`   🔗 Per-user Slack Events/Interactivity: ${slackConfigCount} user${slackConfigCount !== 1 ? 's' : ''} with Bot Token + Signing Secret in app`);
          console.log(`      Request URL: http://localhost:${PORT}/api/slack/events`);
          console.log(`      Interactivity: http://localhost:${PORT}/api/slack/interactions`);
          console.log(`      (Use your public URL in production Slack app settings)`);
      } else {
          console.log(`   ℹ️  No users have Slack Bot Token + Signing Secret saved in the app yet`);
      }
  } catch (error: unknown) {
      const err = error as { code?: string; message?: string };
      // Missing table = DB migrations not applied yet (should be rare after await initializeDatabase)
      if (err?.code === '42P01') {
          console.warn('⚠️  Slack service check skipped: database schema not ready (users table missing).');
          return;
      }
      console.error('⚠️  Error initializing Slack services:', error);
      console.warn('   Slack integration may not work properly');
  }
}

// POST /api/test-connection - Test data source connection
app.post('/api/test-connection', async (req, res) => {
  try {
      const { dataSourceType, connectionConfig } = req.body;

      if (!dataSourceType) {
          return res.status(400).json({ error: 'Data source type is required' });
      }

      if (!connectionConfig) {
          return res.status(400).json({ error: 'Connection configuration is required' });
      }

      let result: { success: boolean; error?: string };

      switch (dataSourceType) {
          case 'bigquery':
              if (!connectionConfig.projectId || !connectionConfig.serviceAccountKey) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Project ID and Service Account Key are required for BigQuery' 
                  });
              }
              result = await testBigQueryConnection({
                  projectId: connectionConfig.projectId,
                  serviceAccountKey: connectionConfig.serviceAccountKey
              });
              break;

          case 'airtable':
              if (!connectionConfig.apiKey || !connectionConfig.baseId) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'API Key (Airtable Token) and Base ID are required for Airtable' 
                  });
              }
              const airtableClient = createAirtableClient({
                  apiKey: connectionConfig.apiKey,
                  baseId: connectionConfig.baseId
              });
              result = await airtableClient.testConnection();
              // If result has an error but success is true, it's a warning (not a failure)
              if (result.success && result.error) {
                  return res.json({ 
                      success: true, 
                      message: result.error || 'Connection verified (with warnings)' 
                  });
              }
              break;

          case 'redshift':
              // Validate required fields first
              // If connectionMethod is 'url', we need either jdbcUrl or a host that starts with jdbc:redshift://
              if (connectionConfig.connectionMethod === 'url') {
                  const jdbcUrl = connectionConfig.jdbcUrl || connectionConfig.host || connectionConfig.server || connectionConfig.serverUrl;
                  if (!jdbcUrl || !jdbcUrl.startsWith('jdbc:redshift://')) {
                      return res.status(400).json({ 
                          success: false, 
                          error: 'Valid JDBC URL is required when using URL connection method. Format: jdbc:redshift://host:port/database' 
                      });
                  }
              } else {
                  // For host method, validate host separately
                  if (!connectionConfig.host && !connectionConfig.server) {
                      return res.status(400).json({ 
                          success: false, 
                          error: 'Host is required' 
                      });
                  }
              }
              const redshiftUsesPgPass = String(connectionConfig.authMethod || '').toLowerCase() === 'pgpass';
              if (!connectionConfig.username || (!redshiftUsesPgPass && !connectionConfig.password)) {
                  return res.status(400).json({ 
                      success: false, 
                      error: redshiftUsesPgPass
                        ? 'Username is required'
                        : 'Username and Password are required'
                  });
              }
              {
                  const ok = await validateRedshiftConnection({
                      host: connectionConfig.host || connectionConfig.server || connectionConfig.serverUrl || '',
                      port: connectionConfig.port,
                      database: connectionConfig.database,
                      user: connectionConfig.username,
                      ...(connectionConfig.password ? { password: connectionConfig.password } : {}),
                      schema: connectionConfig.schema,
                  });
                  result = { success: ok, error: ok ? undefined : 'Could not connect to Redshift' };
              }
              break;

          case 'postgres':
              // Validate required fields first
              if (!connectionConfig.host && !connectionConfig.server) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Host is required' 
                  });
              }
              if (!connectionConfig.database || !connectionConfig.username || !connectionConfig.password) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Database, Username, and Password are required' 
                  });
              }
              {
                  const ok = await validatePostgreSQLConnection({
                      host: connectionConfig.host || connectionConfig.server,
                      port: connectionConfig.port,
                      database: connectionConfig.database,
                      user: connectionConfig.username,
                      password: connectionConfig.password,
                      schema: connectionConfig.schema,
                  });
                  result = { success: ok, error: ok ? undefined : 'Could not connect to PostgreSQL' };
              }
              break;
              
          case 'azure':
              // Validate required fields first
              if (!connectionConfig.server && !connectionConfig.host) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Server or Host is required for Azure SQL' 
                  });
              }
              if (!connectionConfig.database) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Database is required for Azure SQL' 
                  });
              }
              // Only require username/password for SQL authentication (not Windows auth)
              if (connectionConfig.authMethod === 'windows') {
                  // Windows authentication not supported in connection test
                  return res.json({ 
                      success: true, 
                      message: 'Azure SQL configuration validated. Windows Authentication cannot be tested programmatically.' 
                  });
              }
              if (!connectionConfig.username || !connectionConfig.password) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Username and Password are required for SQL Server Authentication' 
                  });
              }
              {
                  const ok = await validateAzureSQLConnection({
                      server: connectionConfig.server || connectionConfig.host || '',
                      database: connectionConfig.database,
                      user: connectionConfig.username,
                      password: connectionConfig.password,
                      port: connectionConfig.port,
                  });
                  result = { success: ok, error: ok ? undefined : 'Could not connect to Azure SQL' };
              }
              break;
              
          case 'mysql':
              // Validate required fields
              if (!connectionConfig.host && !connectionConfig.server) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Host is required for MySQL' 
                  });
              }
              if (!connectionConfig.database || !connectionConfig.username || !connectionConfig.password) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Database, Username, and Password are required for MySQL' 
                  });
              }
              {
                  const ok = await validateMySQLConnection({
                      host: connectionConfig.host || connectionConfig.server,
                      port: connectionConfig.port,
                      database: connectionConfig.database,
                      user: connectionConfig.username,
                      password: connectionConfig.password,
                  });
                  result = { success: ok, error: ok ? undefined : 'Could not connect to MySQL' };
              }
              break;
              
          case 'snowflake':
              // Validate required fields
              // Map host to account if account is not present (for backward compatibility)
              if (!connectionConfig.account && connectionConfig.host) {
                  connectionConfig.account = connectionConfig.host;
              }
              
              if (!connectionConfig.account || !connectionConfig.warehouse || 
                  !connectionConfig.database || !connectionConfig.username || 
                  !connectionConfig.password) {
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Account, Warehouse, Database, Username, and Password are required for Snowflake' 
                  });
              }
              {
                  const ok = await validateSnowflakeConnection({
                      account: connectionConfig.account,
                      warehouse: connectionConfig.warehouse,
                      database: connectionConfig.database,
                      schema: connectionConfig.schema || 'PUBLIC',
                      username: connectionConfig.username,
                      password: connectionConfig.password,
                  });
                  result = { success: ok, error: ok ? undefined : 'Could not connect to Snowflake' };
              }
              break;

          case 'databricks':
              // Validate based on connection method
              const connectionMethod = connectionConfig.connectionMethod || (connectionConfig.jdbcUrl ? 'url' : 'host');
              
              if (connectionMethod === 'host') {
                  // For Client connection: need Host, Client ID, and Client Secret
                  if (!connectionConfig.serverHostname && !connectionConfig.host && !connectionConfig.server) {
                      return res.status(400).json({ 
                          success: false, 
                          error: 'Host is required for Databricks Client connection' 
                      });
                  }
                  if (!connectionConfig.clientId || !connectionConfig.clientSecret) {
                      return res.status(400).json({ 
                          success: false, 
                          error: 'Client ID and Client Secret are required for Databricks Client connection' 
                      });
                  }
                  // Client connection not yet implemented for testing
                  return res.status(400).json({ 
                      success: false, 
                      error: 'Databricks Client connection testing not yet implemented. Please use URL connection with token.' 
                  });
              } else if (connectionMethod === 'url') {
                  // For URL connection: require JDBC URL and token/accessToken.
                  // tokenName is optional for validation (UI label only).
                  if (!connectionConfig.jdbcUrl || (!connectionConfig.token && !connectionConfig.accessToken)) {
                      return res.status(400).json({ 
                          success: false, 
                          error: 'JDBC URL and Token are required for Databricks URL connection' 
                      });
                  }
              }
              {
                  const jdbcUrl = connectionConfig.jdbcUrl as string | undefined;
                  const hostFromJdbc = jdbcUrl?.match(/^jdbc:databricks:\/\/([^:\/;?]+)/i)?.[1];
                  const httpPathFromJdbc = jdbcUrl?.match(/[;?]httpPath=([^;]+)/i)?.[1];
                  const ok = await validateDatabricksConnection({
                      host:
                          hostFromJdbc ||
                          connectionConfig.serverHostname ||
                          connectionConfig.host ||
                          connectionConfig.server ||
                          '',
                      token: connectionConfig.token || connectionConfig.accessToken || '',
                      httpPath: connectionConfig.httpPath || (httpPathFromJdbc ? decodeURIComponent(httpPathFromJdbc) : ''),
                      catalog: connectionConfig.catalog,
                      schema: connectionConfig.schema,
                  });
                  result = { success: ok, error: ok ? undefined : 'Could not connect to Databricks' };
              }
              break;

          default:
              return res.status(400).json({ 
                  success: false, 
                  error: `Connection testing not yet implemented for ${dataSourceType}` 
              });
      }

      if (result.success) {
          return res.json({ success: true, message: 'Connection successful!' });
      } else {
          return res.status(400).json({ 
              success: false, 
              error: result.error || 'Connection test failed' 
          });
      }
  } catch (error) {
      console.error('Error testing connection:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
          return res.status(500).json({ 
          success: false, 
          error: `Failed to test connection: ${errorMessage}` 
      });
  }
});

// GET /api/settings/llm/env-status — which server env API keys are set (no secrets)
app.get('/api/settings/llm/env-status', (_req, res) => {
  const gemini =
      !!process.env.GEMINI_API_KEY?.trim() || !!process.env.GOOGLE_AI_API_KEY?.trim();
  res.json({
      success: true,
      env: {
          openai: !!process.env.OPENAI_API_KEY?.trim(),
          gemini,
          anthropic: !!process.env.ANTHROPIC_API_KEY?.trim(),
      },
  });
});

// GET /api/settings/llm - Get user's LLM settings
app.get('/api/settings/llm', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const settings = await llmSettingsService.getLLMSettings(req.userId);
      
      if (!settings) {
          return res.json({
              success: true,
              provider: 'openai',
              modelType: 'full',
              connectionStatus: 'untested',
              hasOpenaiKey: false,
              hasGeminiKey: false,
              hasAnthropicKey: false,
              envLlmPreference: 'random',
          });
      }

      res.json({
          success: true,
          provider: settings.provider,
          modelType: settings.modelType,
          connectionStatus: settings.connectionStatus,
          hasOpenaiKey: !!settings.openaiApiKey,
          hasGeminiKey: !!settings.geminiApiKey,
          hasAnthropicKey: !!settings.anthropicApiKey,
          envLlmPreference: settings.envLlmPreference || 'random',
      });
  } catch (error) {
      console.error('Error getting LLM settings:', error);
      res.status(500).json({ error: 'Failed to get LLM settings' });
  }
});

// GET /api/settings/llm/effective - Get effective LLM resolution (debug, no secrets)
app.get('/api/settings/llm/effective', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const preferredProvider = parseLLMProviderString(
          typeof req.query.provider === 'string' ? req.query.provider : undefined
      );

      const settings = await llmSettingsService.getLLMSettings(req.userId);
      const hasUserOpenaiKey = !!settings?.openaiApiKey?.trim();
      const hasUserGeminiKey = !!settings?.geminiApiKey?.trim();
      const hasUserAnthropicKey = !!settings?.anthropicApiKey?.trim();
      const userHasAnyKey = hasUserOpenaiKey || hasUserGeminiKey || hasUserAnthropicKey;

      const envAvailability = {
          openai: !!process.env.OPENAI_API_KEY?.trim(),
          gemini: !!(process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_AI_API_KEY?.trim()),
          anthropic: !!process.env.ANTHROPIC_API_KEY?.trim(),
      };

      const effective = await getLLMConfig(req.userId, preferredProvider);

      const source: 'user' | 'env' | 'none' = effective
          ? (userHasAnyKey ? 'user' : 'env')
          : 'none';

      return res.json({
          success: true,
          source,
          preferredProvider: preferredProvider || null,
          effective: effective
              ? {
                    provider: effective.provider,
                    model: effective.model || null,
                    useLightModel: effective.useLightModel,
                }
              : null,
          userSettings: {
              provider: settings?.provider || null,
              modelType: settings?.modelType || null,
              envLlmPreference: settings?.envLlmPreference || 'random',
              hasOpenaiKey: hasUserOpenaiKey,
              hasGeminiKey: hasUserGeminiKey,
              hasAnthropicKey: hasUserAnthropicKey,
          },
          envAvailability,
      });
  } catch (error) {
      console.error('Error getting effective LLM settings:', error);
      return res.status(500).json({ error: 'Failed to get effective LLM settings' });
  }
});

// POST /api/settings/llm - Save user's LLM settings
app.post('/api/settings/llm', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const {
          provider,
          modelType,
          openaiApiKey,
          geminiApiKey,
          anthropicApiKey,
          openaiModelName,
          geminiModelName,
          anthropicModelName,
          envLlmPreference,
      } = req.body;

      if (!provider || !['openai', 'gemini', 'anthropic'].includes(provider)) {
          return res.status(400).json({ error: 'Valid provider (openai, gemini, or anthropic) is required' });
      }

      if (!modelType || (modelType !== 'full' && modelType !== 'light' && modelType !== 'custom')) {
          return res.status(400).json({ error: 'Valid modelType (full, light, or custom) is required' });
      }

      const pref = envLlmPreference && ['random', 'openai', 'gemini', 'anthropic'].includes(envLlmPreference)
          ? envLlmPreference
          : 'random';

      const existingSettings = await llmSettingsService.getLLMSettings(req.userId);
      let connectionStatus: 'connected' | 'failed' | 'untested' = 'untested';

      if (existingSettings) {
          let existingApiKey: string | null | undefined;
          let newApiKey: string | undefined;
          if (provider === 'openai') {
              existingApiKey = existingSettings.openaiApiKey;
              newApiKey = openaiApiKey?.trim();
          } else if (provider === 'gemini') {
              existingApiKey = existingSettings.geminiApiKey;
              newApiKey = geminiApiKey?.trim();
          } else {
              existingApiKey = existingSettings.anthropicApiKey;
              newApiKey = anthropicApiKey?.trim();
          }

          if (existingApiKey && newApiKey && existingApiKey === newApiKey && existingSettings.provider === provider) {
              connectionStatus = existingSettings.connectionStatus;
          } else {
              connectionStatus = 'untested';
          }
      }

      const normalizedModelType = modelType === 'custom' ? 'full' : modelType;

      const settings = await llmSettingsService.saveLLMSettings({
          userId: req.userId,
          provider,
          modelType: normalizedModelType,
          openaiApiKey,
          geminiApiKey,
          anthropicApiKey,
          openaiModelName: openaiModelName?.trim() || null,
          geminiModelName: geminiModelName?.trim() || null,
          anthropicModelName: anthropicModelName?.trim() || null,
          envLlmPreference: pref,
          connectionStatus,
      });

      const returnedModelType =
          modelType === 'custom' ||
          (provider === 'openai' && settings.openaiModelName) ||
          (provider === 'gemini' && settings.geminiModelName) ||
          (provider === 'anthropic' && settings.anthropicModelName)
              ? 'custom'
              : settings.modelType;

      res.json({
          success: true,
          message: 'LLM settings saved successfully',
          provider: settings.provider,
          modelType: returnedModelType,
          connectionStatus: settings.connectionStatus,
          envLlmPreference: settings.envLlmPreference,
      });
  } catch (error) {
      console.error('Error saving LLM settings:', error);
      res.status(500).json({ error: 'Failed to save LLM settings' });
  }
});

// POST /api/settings/llm/test - Test LLM connection
app.post('/api/settings/llm/test', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { provider, openaiApiKey, geminiApiKey, anthropicApiKey, modelName } = req.body;

      if (!provider || !['openai', 'gemini', 'anthropic'].includes(provider)) {
          return res.status(400).json({ error: 'Valid provider is required' });
      }

      const apiKey =
          provider === 'openai' ? openaiApiKey : provider === 'gemini' ? geminiApiKey : anthropicApiKey;
      if (!apiKey?.trim()) {
          return res.status(400).json({ error: 'API key is required' });
      }
      const trimmedApiKey = apiKey.trim();

      const testModelName =
          modelName ||
          (provider === 'openai'
              ? 'gpt-4o-mini'
              : provider === 'gemini'
                ? 'gemini-2.0-flash'
                : resolveAnthropicModelId('claude-3-5-haiku-20241022'));

      try {
          if (provider === 'openai') {
              const OpenAI = require('openai');
              const client = new OpenAI({ apiKey: trimmedApiKey });
              await client.chat.completions.create({
                  model: testModelName,
                  messages: [{ role: 'user', content: 'test' }],
                  max_completion_tokens: 5,
              });
          } else if (provider === 'gemini') {
              const { GoogleGenerativeAI } = require('@google/generative-ai');
              const genAI = new GoogleGenerativeAI(trimmedApiKey);
              const model = genAI.getGenerativeModel({ model: testModelName });
              await model.generateContent('test');
          } else {
              const Anthropic = require('@anthropic-ai/sdk');
              const client = new Anthropic({ apiKey: trimmedApiKey });
              await client.messages.create({
                  model: testModelName,
                  max_tokens: 8,
                  messages: [{ role: 'user', content: 'hi' }],
              });
          }

          // Persist tested provider/key so reloads keep provider + status in sync
          // (previous logic only updated status when a row already existed).
          const existingSettings = await llmSettingsService.getLLMSettings(req.userId);
          await llmSettingsService.saveLLMSettings({
              userId: req.userId,
              provider,
              modelType: existingSettings?.modelType || 'full',
              openaiApiKey:
                  provider === 'openai'
                      ? trimmedApiKey
                      : existingSettings?.openaiApiKey || '',
              geminiApiKey:
                  provider === 'gemini'
                      ? trimmedApiKey
                      : existingSettings?.geminiApiKey || '',
              anthropicApiKey:
                  provider === 'anthropic'
                      ? trimmedApiKey
                      : existingSettings?.anthropicApiKey || '',
              openaiModelName:
                  provider === 'openai'
                      ? testModelName
                      : existingSettings?.openaiModelName || null,
              geminiModelName:
                  provider === 'gemini'
                      ? testModelName
                      : existingSettings?.geminiModelName || null,
              anthropicModelName:
                  provider === 'anthropic'
                      ? testModelName
                      : existingSettings?.anthropicModelName || null,
              envLlmPreference: existingSettings?.envLlmPreference || 'random',
              connectionStatus: 'connected',
          });

          res.json({
              success: true,
              message: 'Connection test successful',
          });
      } catch (testError: any) {
          await llmSettingsService.updateConnectionStatus(req.userId, 'failed');

          res.status(400).json({
              success: false,
              error: testError.message || 'Connection test failed',
          });
      }
  } catch (error: any) {
      console.error('Error testing LLM connection:', error);
      res.status(500).json({ error: 'Failed to test LLM connection' });
  }
});

// DELETE /api/settings/llm - Delete user's LLM settings
app.delete('/api/settings/llm', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const deleted = await llmSettingsService.deleteLLMSettings(req.userId);

      if (deleted) {
          res.json({ success: true, message: 'LLM settings deleted successfully' });
      } else {
          res.status(404).json({ error: 'LLM settings not found' });
      }
  } catch (error) {
      console.error('Error deleting LLM settings:', error);
      res.status(500).json({ error: 'Failed to delete LLM settings' });
  }
});

// ==================== NOTIFICATIONS ====================

// GET /api/notifications - List notifications for current user
app.get('/api/notifications', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }
      const limit = Math.min(parseInt(String(req.query.limit), 10) || 50, 100);
      const notifications = await notificationService.listForUser(req.userId, limit);
      res.json({ success: true, notifications });
  } catch (error: any) {
      console.error('Error listing notifications:', error);
      res.status(500).json({ error: error.message || 'Failed to get notifications' });
  }
});

// PATCH /api/notifications/:id/read - Mark notification as read
app.patch('/api/notifications/:id/read', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }
      const id = parseInt(req.params.id, 10);
      if (isNaN(id)) return res.status(400).json({ error: 'Invalid notification ID' });
      const updated = await notificationService.markRead(id, req.userId);
      res.json({ success: true, read: updated });
  } catch (error: any) {
      console.error('Error marking notification read:', error);
      res.status(500).json({ error: error.message || 'Failed to update notification' });
  }
});

// ==================== SUBSCRIPTION & PAYMENT ENDPOINTS ====================

// GET /api/subscription - Get user's current subscription
app.get('/api/subscription', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const subscription = await subscriptionService.getSubscription(req.userId);
      const limits = await subscriptionService.getPlanLimitsForUser(req.userId);

      if (!subscription) {
          // Return free plan limits if no subscription
          return res.json({
              success: true,
              subscription: null,
              planName: 'free',
              planType: 'monthly',
              status: 'active',
              limits: limits
          });
      }

      // Payment reminders: fire-and-forget
      (async () => {
          try {
              const periodEnd = new Date(subscription.currentPeriodEnd);
              const periodStart = new Date(subscription.currentPeriodStart);
              const now = new Date();
              const sevenDaysFromNow = new Date(now);
              sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);

              if (subscription.status === 'past_due') {
                  const since = new Date(now);
                  since.setDate(since.getDate() - 7);
                  const already = await notificationService.hasNotificationSince(req.userId!, 'payment_failed', since);
                  if (!already) {
                      const title = 'Payment failed';
                      const message = 'Your payment could not be processed. Please update your payment method to avoid service interruption.';
                      const notif = await notificationService.createNotification({ userId: req.userId!, type: 'payment_failed', title, message });
                      const user = await userService.getUserById(req.userId!);
                      if (user?.email) {
                          try {
                              const html = `<div style="font-family: Arial, sans-serif;"><h2>${title}</h2><p>${message}</p><p><a href="${process.env.FRONTEND_URL || 'https://app.aiquery.ai'}/app_admin">Update payment in AIquery</a></p></div>`;
                              await resendService.sendNotificationEmail(user.email, title + ' – AIquery', html);
                              await notificationService.setEmailSent(notif.id);
                          } catch (e) { console.warn('Notification email failed:', e); }
                      }
                  }
              }

              if (periodEnd <= sevenDaysFromNow && periodEnd >= now && subscription.planName !== 'free') {
                  const already = await notificationService.hasNotificationSince(req.userId!, 'payment_due', periodStart);
                  if (!already) {
                      const title = 'Payment due soon';
                      const message = `Your subscription renews on ${periodEnd.toLocaleDateString()}. Ensure your payment method is up to date.`;
                      const notif = await notificationService.createNotification({ userId: req.userId!, type: 'payment_due', title, message });
                      const user = await userService.getUserById(req.userId!);
                      if (user?.email) {
                          try {
                              const html = `<div style="font-family: Arial, sans-serif;"><h2>${title}</h2><p>${message}</p><p><a href="${process.env.FRONTEND_URL || 'https://app.aiquery.ai'}/app_admin">Manage subscription in AIquery</a></p></div>`;
                              await resendService.sendNotificationEmail(user.email, title + ' – AIquery', html);
                              await notificationService.setEmailSent(notif.id);
                          } catch (e) { console.warn('Notification email failed:', e); }
                      }
                  }
              }
          } catch (e) {
              console.warn('Payment notification check failed:', e);
          }
      })();

      res.json({
          success: true,
          subscription: {
              id: subscription.id,
              planName: subscription.planName,
              planType: subscription.planType,
              status: subscription.status,
              currentPeriodStart: subscription.currentPeriodStart,
              currentPeriodEnd: subscription.currentPeriodEnd,
              cancelAtPeriodEnd: subscription.cancelAtPeriodEnd
          },
          limits: limits
      });
  } catch (error) {
      console.error('Error getting subscription:', error);
      res.status(500).json({ error: 'Failed to get subscription' });
  }
});

// POST /api/subscription/add-users - Add extra user slots to the account
app.post('/api/subscription/add-users', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }
      const { count, billingPeriod } = req.body;
      const num = typeof count === 'number' ? count : parseInt(String(count), 10);
      if (!Number.isInteger(num) || num < 1) {
          return res.status(400).json({ error: 'Valid count (integer >= 1) is required' });
      }
      const result = await subscriptionService.addExtraUsers(req.userId, num);
      if (!result.success) {
          return res.status(400).json({ error: 'No active subscription. Upgrade to a plan first to add users.' });
      }
      const limits = await subscriptionService.getPlanLimitsForUser(req.userId);
      res.json({
          success: true,
          extraUsers: result.extraUsers,
          limits
      });
  } catch (error) {
      console.error('Error adding users:', error);
      res.status(500).json({ error: 'Failed to add users' });
  }
});

// POST /api/subscription - Create or update subscription
app.post('/api/subscription', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { planName, planType, stripeSubscriptionId, stripeCustomerId } = req.body;

      if (!planName || !planType) {
          return res.status(400).json({ error: 'planName and planType are required' });
      }

      if (!['free', 'startpro', 'smartpro', 'enterprise'].includes(planName)) {
          return res.status(400).json({ error: 'Invalid plan name' });
      }

      if (!['monthly', 'annual'].includes(planType)) {
          return res.status(400).json({ error: 'Invalid plan type' });
      }

      // Calculate period dates - start from current date instead of 1st of month
      const now = new Date();
      const currentPeriodStart = new Date(now); // Start from current date
      let currentPeriodEnd: Date;
      
      if (planName === 'free') {
          // Free plan: 30 days free trial from signup/payment date
          currentPeriodEnd = new Date(now);
          currentPeriodEnd.setDate(currentPeriodEnd.getDate() + 30);
      } else if (planType === 'annual') {
          // Annual plan: 1 year from payment date
          currentPeriodEnd = new Date(now);
          currentPeriodEnd.setFullYear(currentPeriodEnd.getFullYear() + 1);
      } else {
          // Monthly plan: 1 month from payment date
          currentPeriodEnd = new Date(now);
          currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
      }

      // Create subscription
      const subscription = await subscriptionService.createSubscription({
          userId: req.userId,
          planName: planName as PlanName,
          planType: planType as PlanType,
          stripeSubscriptionId,
          stripeCustomerId,
          currentPeriodStart,
          currentPeriodEnd
      });
      
      // Update status for free plan to 'trialing' (30-day trial)
      if (planName === 'free') {
          await subscriptionService.updateSubscriptionStatus(req.userId, 'trialing');
          // Re-fetch subscription to get updated status
          const updatedSubscription = await subscriptionService.getSubscription(req.userId);
          if (updatedSubscription) {
              // Use updated subscription for response
              const subscriptionForResponse = updatedSubscription;
              res.json({
                  success: true,
                  subscription: {
                      id: subscriptionForResponse.id,
                      planName: subscriptionForResponse.planName,
                      planType: subscriptionForResponse.planType,
                      status: subscriptionForResponse.status,
                      currentPeriodStart: subscriptionForResponse.currentPeriodStart,
                      currentPeriodEnd: subscriptionForResponse.currentPeriodEnd
                  }
              });
              return;
          }
      }

      // Create payment record if not free plan
      if (planName !== 'free') {
          const price = paymentService.getPlanPrice(planName as PlanName, planType as PlanType);
          await paymentService.createPayment({
              userId: req.userId,
              subscriptionId: subscription.id,
              amount: price,
              currency: 'USD',
              status: 'succeeded',
              planName: planName as PlanName,
              planType: planType as PlanType,
              itemType: 'plan',
              billingPeriodStart: currentPeriodStart,
              billingPeriodEnd: currentPeriodEnd,
              stripePaymentIntentId: stripeSubscriptionId
          });
      }

  } catch (error) {
      console.error('Error creating subscription:', error);
      res.status(500).json({ error: 'Failed to create subscription' });
  }
});

// POST /api/subscription/cancel - Cancel subscription (at period end)
app.post('/api/subscription/cancel', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { cancelAtPeriodEnd } = req.body;
      const cancelAtEnd = cancelAtPeriodEnd !== false;

      const subscription = cancelAtEnd ? await subscriptionService.getSubscription(req.userId) : null;
      if (cancelAtEnd && subscription?.stripeSubscriptionId) {
          await stripeService.setSubscriptionCancelAtPeriodEnd(subscription.stripeSubscriptionId, true);
      }

      const canceled = await subscriptionService.cancelSubscription(req.userId, cancelAtEnd);

      if (canceled) {
          res.json({ success: true, message: 'Subscription canceled successfully' });
      } else {
          res.status(404).json({ error: 'Subscription not found' });
      }
  } catch (error: any) {
      console.error('Error canceling subscription:', error);
      res.status(500).json({ error: error?.message || 'Failed to cancel subscription' });
  }
});

// POST /api/subscription/reactivate - Reactivate subscription (clear cancel at period end)
app.post('/api/subscription/reactivate', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const subscription = await subscriptionService.getSubscription(req.userId);
      if (!subscription) {
          return res.status(404).json({ error: 'No subscription found' });
      }

      if (!subscription.cancelAtPeriodEnd) {
          return res.json({ success: true, message: 'Subscription is already active' });
      }

      if (subscription.stripeSubscriptionId) {
          await stripeService.setSubscriptionCancelAtPeriodEnd(subscription.stripeSubscriptionId, false);
      }

      await subscriptionService.cancelSubscription(req.userId, false);

      res.json({ success: true, message: 'Subscription reactivated. It will continue to renew at the end of each period.' });
  } catch (error: any) {
      console.error('Error reactivating subscription:', error);
      res.status(500).json({ error: error?.message || 'Failed to reactivate subscription' });
  }
});

// GET /api/payments - Get user's payment history
app.get('/api/payments', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const payments = await paymentService.getPaymentsByUser(req.userId, limit);

      res.json({
          success: true,
          payments: payments.map(payment => ({
              id: payment.id,
              amount: payment.amount,
              currency: payment.currency,
              status: payment.status,
              planName: payment.planName,
              planType: payment.planType,
              itemType: payment.itemType || 'plan',
              createdAt: payment.createdAt,
              billingPeriodStart: payment.billingPeriodStart,
              billingPeriodEnd: payment.billingPeriodEnd
          }))
      });
  } catch (error) {
      console.error('Error getting payments:', error);
      res.status(500).json({ error: 'Failed to get payments' });
  }
});

// POST /api/payments - Create a new payment
app.post('/api/payments', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { amount, currency, status, paymentMethod, planName, planType, itemType, billingPeriodStart, billingPeriodEnd } = req.body;

      if (!amount || !planName || !planType) {
          return res.status(400).json({ error: 'amount, planName, and planType are required' });
      }

      const payment = await paymentService.createPayment({
          userId: req.userId,
          amount: parseFloat(amount),
          currency: currency || 'USD',
          status: status || 'pending',
          paymentMethod: paymentMethod || 'manual',
          planName: planName as PlanName,
          planType: planType as PlanType,
          itemType: itemType === 'add_users' ? 'add_users' : 'plan',
          billingPeriodStart: billingPeriodStart ? new Date(billingPeriodStart) : undefined,
          billingPeriodEnd: billingPeriodEnd ? new Date(billingPeriodEnd) : undefined
      });

      res.json({
          success: true,
          payment: {
              id: payment.id,
              amount: payment.amount,
              currency: payment.currency,
              status: payment.status,
              planName: payment.planName,
              planType: payment.planType,
              createdAt: payment.createdAt
          }
      });
  } catch (error) {
      console.error('Error creating payment:', error);
      res.status(500).json({ error: 'Failed to create payment' });
  }
});

// PUT /api/payments/:paymentId/status - Update payment status
app.put('/api/payments/:paymentId/status', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { paymentId } = req.params;
      const { status } = req.body;

      if (!status || !['pending', 'succeeded', 'failed', 'refunded'].includes(status)) {
          return res.status(400).json({ error: 'Valid status is required' });
      }

      const updated = await paymentService.updatePaymentStatus(
          parseInt(paymentId),
          status as 'pending' | 'succeeded' | 'failed' | 'refunded'
      );

      if (updated) {
          res.json({ success: true, message: 'Payment status updated successfully' });
      } else {
          res.status(404).json({ error: 'Payment not found' });
      }
  } catch (error) {
      console.error('Error updating payment status:', error);
      res.status(500).json({ error: 'Failed to update payment status' });
  }
});

// GET /api/subscription/usage - Get user's usage statistics
app.get('/api/subscription/usage', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const usageStats = await usageTrackingService.getUserUsageStats(req.userId);
      const limits = await subscriptionService.getPlanLimitsForUser(req.userId);
      const currentMonthCount = await usageTrackingService.getCurrentMonthQueryCount(req.userId);
      const queryLimit = await subscriptionService.checkQueryLimit(req.userId, currentMonthCount);

      res.json({
          success: true,
          usage: {
              currentMonth: usageStats.currentMonth,
              lastMonth: usageStats.lastMonth,
              total: usageStats.total
          },
          limits: limits,
          queryLimit: {
              limit: queryLimit.limit,
              current: currentMonthCount,
              remaining: queryLimit.limit === -1 ? -1 : Math.max(0, queryLimit.limit - currentMonthCount),
              exceeded: !queryLimit.allowed
          }
      });
  } catch (error) {
      console.error('Error getting usage stats:', error);
      res.status(500).json({ error: 'Failed to get usage statistics' });
  }
});

// ==================== CHAT HISTORY ENDPOINTS ====================

// GET /api/chat/history/sessions - Get all chat sessions for user
app.get('/api/chat/history/sessions', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const sessions = await chatHistoryService.getUserSessions(req.userId, limit);

      res.json({
          success: true,
          sessions: sessions.map(session => ({
              id: session.id,
              sessionId: session.sessionId,
              title: session.title,
              messageCount: session.messageCount,
              createdAt: session.createdAt,
              updatedAt: session.updatedAt
          }))
      });
  } catch (error) {
      console.error('Error getting chat sessions:', error);
      res.status(500).json({ error: 'Failed to get chat sessions' });
  }
});

// GET /api/chat/history/sessions/:sessionId - Get messages in a session
app.get('/api/chat/history/sessions/:sessionId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { sessionId } = req.params;
      const messages = await chatHistoryService.getSessionMessages(req.userId, sessionId);

      res.json({
          success: true,
          messages: messages.map(msg => ({
              id: msg.id,
              question: msg.question,
              response: msg.response,
              sqlQuery: msg.sqlQuery,
              queryResults: msg.queryResults,
              executionSteps: msg.executionSteps ?? undefined,
              followUpQuestions: msg.followUpQuestions ?? undefined,
              createdAt: msg.createdAt
          }))
      });
  } catch (error) {
      console.error('Error getting session messages:', error);
      res.status(500).json({ error: 'Failed to get session messages' });
  }
});

// GET /api/chat/history/questions - Get recent questions (one item per message)
app.get('/api/chat/history/questions', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const limit = parseInt(req.query.limit as string) || 200;
      const items = await chatHistoryService.getUserQuestionItems(req.userId, limit);

      res.json({
          success: true,
          items: items.map(item => ({
              id: item.id,
              sessionId: item.sessionId,
              question: item.question,
              createdAt: item.createdAt,
              updatedAt: item.updatedAt
          }))
      });
  } catch (error) {
      console.error('Error getting chat question items:', error);
      res.status(500).json({ error: 'Failed to get chat question items' });
  }
});

// PUT /api/chat/history/sessions/:sessionId/title - Update session title
app.put('/api/chat/history/sessions/:sessionId/title', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { sessionId } = req.params;
      const { title } = req.body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
          return res.status(400).json({ error: 'Title is required' });
      }

      const updated = await chatHistoryService.updateSessionTitle(req.userId, sessionId, title.trim());

      if (updated) {
          res.json({ success: true, message: 'Session title updated successfully' });
      } else {
          res.status(404).json({ error: 'Session not found' });
      }
  } catch (error) {
      console.error('Error updating session title:', error);
      res.status(500).json({ error: 'Failed to update session title' });
  }
});

// DELETE /api/chat/history/sessions/:sessionId - Delete a chat session
app.delete('/api/chat/history/sessions/:sessionId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const { sessionId } = req.params;
      const deleted = await chatHistoryService.deleteSession(req.userId, sessionId);

      if (deleted) {
          res.json({ success: true, message: 'Session deleted successfully' });
      } else {
          res.status(404).json({ error: 'Session not found' });
      }
  } catch (error) {
      console.error('Error deleting session:', error);
      res.status(500).json({ error: 'Failed to delete session' });
  }
});

// DELETE /api/chat/history/messages/:messageId - Delete one chat message/question
app.delete('/api/chat/history/messages/:messageId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Unauthorized' });
      }

      const messageId = parseInt(req.params.messageId, 10);
      if (Number.isNaN(messageId) || messageId <= 0) {
          return res.status(400).json({ error: 'Invalid messageId' });
      }

      const deleted = await chatHistoryService.deleteMessage(req.userId, messageId);
      if (deleted) {
          res.json({ success: true, message: 'Message deleted successfully' });
      } else {
          res.status(404).json({ error: 'Message not found' });
      }
  } catch (error) {
      console.error('Error deleting chat message:', error);
      res.status(500).json({ error: 'Failed to delete chat message' });
  }
});

// GET /api/rag/tables - Get available tables from any data source
app.get('/api/rag/tables', async (req, res) => {
  try {
      const { dataSourceType, projectId, serviceAccountKey, datasets, apiKey, baseId, 
              host, server, serverUrl, port, database, username, password, schema, schemas, account, warehouse,
              // Databricks specific fields
              connectionMethod, jdbcUrl, tokenName, token, accessToken, clientId, clientSecret, serverHostname, catalog, authMethod } = req.query;
      
      if (!dataSourceType || typeof dataSourceType !== 'string') {
          return res.status(400).json({ error: 'dataSourceType is required' });
      }
      const sourceType = dataSourceType as string;

      if (sourceType === 'airtable') {
          if (!apiKey || !baseId) {
              return res.status(400).json({ 
                  error: 'apiKey and baseId are required for Airtable' 
              });
          }

          const airtableClient = createAirtableClient({
              apiKey: apiKey as string,
              baseId: baseId as string
          });

          // Try to get tables from meta API
          const tableNames = await airtableClient.getTables();
          
          // Fetch field count for each table by getting schema details
          const tables = await Promise.all(
              tableNames.map(async (tableName) => {
                  try {
                      // Get schema details to count fields
                      const schema = await airtableClient.getTableSchemaDetailed(tableName);
                      return {
                          id: tableName,
                          name: tableName,
                          dataset: '', // Airtable doesn't have datasets
                          table: tableName,
                          fieldCount: schema.fields?.length || 0,
                          rowCount: schema.rowCount
                      };
                  } catch (err) {
                      // If schema fetch fails, still return the table with 0 fields
                      console.warn(`Could not fetch schema for Airtable table ${tableName}:`, err);
                      return {
                          id: tableName,
                          name: tableName,
                          dataset: '',
                          table: tableName,
                          fieldCount: 0,
                          rowCount: undefined
                      };
                  }
              })
          );

          res.json({ tables });
      } else if (sourceType === 'bigquery') {
          // BigQuery
          if (!projectId || !serviceAccountKey) {
              return res.status(400).json({ 
                  error: 'projectId and serviceAccountKey are required for BigQuery' 
              });
          }

          // If datasets parameter is not provided, return list of datasets
          if (!datasets) {
              const { createBigQueryClient } = await import('./services/data_sources/bigquery.service');
              const client = createBigQueryClient({
                  projectId: projectId as string,
                  serviceAccountKey: serviceAccountKey as string
              });

              // List all datasets in the project
              const [datasetsList] = await client.getDatasets({ projectId: projectId as string });
              const datasetList = datasetsList.map(dataset => ({
                  id: dataset.id || dataset.metadata?.id || '',
                  name: dataset.id || dataset.metadata?.id || '',
                  location: dataset.metadata?.location || ''
              })).filter(d => d.id);

              res.json({ datasets: datasetList });
          } else {
              // If datasets parameter is provided, return tables from those datasets
              const datasetsArray = (datasets as string).split(',').map(d => d.trim());
              const schemas = await fetchBigQueryTableSchemas(
                  {
                      projectId: projectId as string,
                      serviceAccountKey: serviceAccountKey as string
                  },
                  datasetsArray
              );

              // Format for frontend
              const tables = schemas.map(schema => ({
                  id: `${schema.datasetId}.${schema.tableId}`,
                  name: `${schema.datasetId}.${schema.tableId}`,
                  dataset: schema.datasetId,
                  table: schema.tableId,
                  fieldCount: schema.schema.length,
                  rowCount: schema.rowCount
              }));

              res.json({ tables });
          }
      } else if (sourceType === 'databricks') {
          // Databricks
          const connMethod = (connectionMethod as string) || 'url';
          if (connMethod === 'host') {
              // Client connection: requires database, clientId, and clientSecret
              if (!database || !clientId || !clientSecret) {
                  return res.status(400).json({ 
                      error: 'database, clientId, and clientSecret are required for Databricks Client connection' 
                  });
              }
          } else {
              // URL connection: requires database, jdbcUrl, tokenName, and token
              if (!database || !jdbcUrl || !tokenName || (!token && !accessToken)) {
                  return res.status(400).json({ 
                      error: 'database, jdbcUrl, tokenName, and token are required for Databricks URL connection' 
                  });
              }
          }

          const sqlConnectionConfig: any = {
              host: (host || server) as string,
              server: server as string,
              port: port ? parseInt(port as string, 10) : undefined,
              database: database as string,
              schema: schema as string,
              schemas: schemas as string,
              connectionMethod: connectionMethod || 'url'
          };

          if (sqlConnectionConfig.connectionMethod === 'host') {
              sqlConnectionConfig.serverHostname = serverHostname || host || server;
              sqlConnectionConfig.clientId = clientId as string;
              sqlConnectionConfig.clientSecret = clientSecret as string;
          } else {
              sqlConnectionConfig.jdbcUrl = jdbcUrl as string;
              sqlConnectionConfig.tokenName = tokenName as string;
              sqlConnectionConfig.token = token || accessToken;
              sqlConnectionConfig.accessToken = token || accessToken;
          }

          // Check if catalogs or schemas are requested
          const requestedCatalog = req.query.catalog as string | undefined;
          const requestedSchemas = req.query.schemas as string | undefined;

          // If no catalog is specified, return list of catalogs
          if (!requestedCatalog && !requestedSchemas) {
              const catalogs = await fetchDatabricksCatalogs(sqlConnectionConfig);
              const catalogList = catalogs.map(cat => ({
                  id: cat,
                  name: cat
              }));
              return res.json({ catalogs: catalogList });
          }

          // If catalog is specified but no schemas, return list of schemas for that catalog
          if (requestedCatalog && !requestedSchemas) {
              const schemasList = await fetchDatabricksSchemas(sqlConnectionConfig, requestedCatalog);
              const schemaList = schemasList.map(sch => ({
                  id: sch,
                  name: sch,
                  catalog: requestedCatalog
              }));
              return res.json({ schemas: schemaList });
          }

          // If both catalog and schemas are specified, fetch tables
          // Update connection config with catalog and schema
          if (requestedCatalog) {
              sqlConnectionConfig.catalog = requestedCatalog;
              console.log(`[API /api/rag/tables] Using catalog: ${requestedCatalog}`);
          }
          if (requestedSchemas) {
              const schemasArray = requestedSchemas.split(',').map(s => s.trim());
              sqlConnectionConfig.schemas = schemasArray.join(',');
              console.log(`[API /api/rag/tables] Using schemas: ${schemasArray.join(', ')}`);
              // Use first schema as default
              if (schemasArray.length > 0) {
                  sqlConnectionConfig.schema = schemasArray[0];
              }
          }

          console.log(`[API /api/rag/tables] Fetching tables with config:`, {
              catalog: sqlConnectionConfig.catalog,
              schemas: sqlConnectionConfig.schemas,
              schema: sqlConnectionConfig.schema,
              database: sqlConnectionConfig.database
          });

          const tableSchemas = await fetchDatabricksTableSchemas(sqlConnectionConfig);
          
          console.log(`[API /api/rag/tables] Fetched ${tableSchemas.length} table schemas`);
          
          if (tableSchemas.length === 0) {
              console.warn(`[API /api/rag/tables] ⚠️ No tables found for catalog: ${requestedCatalog}, schemas: ${requestedSchemas}`);
              console.warn(`[API /api/rag/tables] Connection config used:`, {
                  catalog: sqlConnectionConfig.catalog,
                  schemas: sqlConnectionConfig.schemas,
                  schema: sqlConnectionConfig.schema,
                  database: sqlConnectionConfig.database,
                  connectionMethod: sqlConnectionConfig.connectionMethod
              });
          }

          // Format for frontend - include catalog in the table ID
          const tables = tableSchemas.map((s: any) => {
              const catalog = s.database || requestedCatalog || '';
              const schema = s.schemaName || '';
              const table = s.tableId;
              
              // Build full table identifier: catalog.schema.table
              let fullId = table;
              if (schema) {
                  fullId = `${schema}.${fullId}`;
              }
              if (catalog) {
                  fullId = `${catalog}.${fullId}`;
              }
              
              return {
                  id: fullId,
                  name: fullId,
                  catalog: catalog,
                  dataset: schema, // Use dataset field for schema
                  table: table,
                  fieldCount: s.schema.length,
                  rowCount: s.rowCount
              };
          });

          res.json({ tables });
      } else if (sourceType === 'postgres' || sourceType === 'postgresql') {
          // PostgreSQL
          if (!database || !username || !password) {
              return res.status(400).json({ 
                  error: 'database, username, and password are required for PostgreSQL' 
              });
          }

          const sqlConnectionConfig: any = {
              host: (host || server || serverUrl) as string,
              server: server as string,
              serverUrl: serverUrl as string,
              port: port ? parseInt(port as string, 10) : undefined,
              database: database as string,
              schema: schema as string,
              schemas: schemas as string,
              username: username as string,
              password: password as string
          };

          const tableSchemas = await fetchPostgresSQLTableSchemas(sqlConnectionConfig);

          // Format for frontend
          const tables = tableSchemas.map((s: any) => ({
              id: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
              name: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
              dataset: s.schemaName || '',
              table: s.tableId,
              fieldCount: s.schema.length,
              rowCount: s.rowCount
          }));

          res.json({ tables });
      } else if (sourceType === 'redshift') {
          // Redshift
          const redshiftUsesPgPass = String(authMethod || '').toLowerCase() === 'pgpass';
          if (!database || !username || (!redshiftUsesPgPass && !password)) {
              return res.status(400).json({ 
                  error: redshiftUsesPgPass
                    ? 'database and username are required for Redshift'
                    : 'database, username, and password are required for Redshift'
              });
          }

          const sqlConnectionConfig: any = {
              host: (host || server || serverUrl) as string,
              server: server as string,
              serverUrl: serverUrl as string,
              port: port ? parseInt(port as string, 10) : undefined,
              database: database as string,
              schema: schema as string,
              schemas: schemas as string,
              username: username as string,
              password: password as string | undefined,
              jdbcUrl: jdbcUrl as string,
              connectionMethod: connectionMethod as 'host' | 'url',
              authMethod: authMethod as string | undefined,
          };

          // If no schema is provided, return list of schemas instead of tables
          if (!schema && !schemas) {
              const { Client } = await import('pg');
              const { createRedshiftClient, parseRedshiftJDBCUrl } = await import('./services/data_sources/redshift.service');
              
              let redshiftHost = (host || server || serverUrl) as string;
              let redshiftPort = port ? parseInt(port as string, 10) : 5439;
              let redshiftDatabase = database as string;
              
              // If connectionMethod is 'url' or host looks like JDBC URL, parse it
              if (connectionMethod === 'url' || (redshiftHost && redshiftHost.startsWith('jdbc:redshift://'))) {
                  try {
                      const parsed = parseRedshiftJDBCUrl(redshiftHost);
                      redshiftHost = parsed.host;
                      redshiftPort = parsed.port;
                      if (!redshiftDatabase && parsed.database) {
                          redshiftDatabase = parsed.database;
                      }
                  } catch (error) {
                      return res.status(400).json({ 
                          error: `Failed to parse Redshift JDBC URL: ${error instanceof Error ? error.message : String(error)}` 
                      });
                  }
              }
              
              const pgClient = createRedshiftClient({
                  host: redshiftHost,
                  port: redshiftPort,
                  database: redshiftDatabase,
                  username: username as string,
                  ...(password ? { password: password as string } : {})
              });
              
              try {
                  await pgClient.connect();
                  
                  // Fetch list of schemas
                  // Query both information_schema.schemata and information_schema.tables to get complete list
                  // This ensures we get all schemas, including those that might not appear in schemata
                  // Also try pg_namespace as a fallback for Redshift-specific schema visibility
                  // Filter out system schemas including Redshift-specific ones
                  const schemasQuery = `
                      SELECT DISTINCT schema_name
                      FROM (
                          SELECT schema_name FROM information_schema.schemata
                          UNION
                          SELECT DISTINCT table_schema AS schema_name FROM information_schema.tables
                          UNION
                          SELECT nspname AS schema_name FROM pg_namespace
                      ) AS all_schemas
                      WHERE schema_name NOT IN (
                          'information_schema', 
                          'pg_catalog', 
                          'pg_toast', 
                          'pg_internal',
                          'catalog_history',
                          'pg_auto_copy',
                          'pg_automv',
                          'pg_mv',
                          'pg_s3'
                      )
                      ORDER BY schema_name
                  `;
                  
                  console.log('[Redshift] Executing schema query:', schemasQuery);
                  const schemasResult = await pgClient.query(schemasQuery);
                  const schemaList = schemasResult.rows.map((row: any) => row.schema_name);
                  
                  console.log(`[Redshift] Found ${schemaList.length} schemas:`, schemaList);
                  
                  // If we still don't have "public", try a direct query to pg_namespace
                  if (!schemaList.includes('public')) {
                      console.log('[Redshift] "public" schema not found, trying direct pg_namespace query...');
                      try {
                          const publicQuery = `SELECT nspname FROM pg_namespace WHERE nspname = 'public'`;
                          const publicResult = await pgClient.query(publicQuery);
                          if (publicResult.rows.length > 0) {
                              console.log('[Redshift] Found "public" schema in pg_namespace, adding to list');
                              schemaList.push('public');
                              schemaList.sort();
                          }
                      } catch (err) {
                          console.warn('[Redshift] Error querying pg_namespace for public schema:', err);
                      }
                  }
                  
                  await pgClient.end();
                  
                  return res.json({ schemas: schemaList });
              } catch (error) {
                  if (pgClient) {
                      try {
                          await pgClient.end();
                      } catch (closeError) {
                          console.warn('Error closing Redshift connection:', closeError);
                      }
                  }
                  throw error;
              }
          }

          const tableSchemas = await fetchRedshiftTableSchemas(sqlConnectionConfig);

          // Format for frontend
          const tables = tableSchemas.map((s: any) => ({
              id: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
              name: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
              dataset: s.schemaName || '',
              table: s.tableId,
              fieldCount: s.schema.length,
              rowCount: s.rowCount
          }));

          res.json({ tables });
      } else if (sourceType === 'azure' || sourceType === 'sqlserver') {
          // Azure SQL Server
          if (!database || !username || !password) {
              return res.status(400).json({ 
                  error: 'database, username, and password are required for Azure SQL Server' 
              });
          }

          const sqlConnectionConfig: any = {
              host: (host || server) as string,
              server: server as string,
              port: port ? parseInt(port as string, 10) : undefined,
              database: database as string,
              schema: schema as string,
              schemas: schemas as string,
              username: username as string,
              password: password as string
          };

          const tableSchemas = await fetchAzureSQLTableSchemas(sqlConnectionConfig);

          // Format for frontend
          const tables = tableSchemas.map((s: any) => ({
              id: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
              name: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
              dataset: s.schemaName || '',
              table: s.tableId,
              fieldCount: s.schema.length,
              rowCount: s.rowCount
          }));

          res.json({ tables });
      } else if (sourceType === 'snowflake') {
          // Snowflake
          const snowflakeAccount = (account as string) || (host as string) || (server as string);
          if (!snowflakeAccount || !warehouse || !database || !username || !password) {
              return res.status(400).json({ 
                  error: 'Account (or Host), Warehouse, Database, Username, and Password are required for Snowflake' 
              });
          }

          // If schema parameter is not provided, return list of schemas
          if (!schema) {
              let snowflake: any;
              try {
                  snowflake = require('snowflake-sdk');
              } catch (error) {
                  return res.status(400).json({ 
                      error: 'Snowflake SDK (snowflake-sdk) is required. Please install it: npm install snowflake-sdk' 
                  });
              }
              
              // Normalize account input from host/account fields.
              const cleanAccount = normalizeSnowflakeAccountInput(snowflakeAccount);
              
              const connectionConfig_snowflake = {
                  account: cleanAccount,
                  username: username as string,
                  password: password as string,
                  warehouse: warehouse as string,
                  database: database as string,
                  schema: 'PUBLIC', // Use PUBLIC as default for fetching schemas
                  role: undefined
              };
              
              // Create connection
              const connection = snowflake.createConnection(connectionConfig_snowflake);
              
              // Helper function to execute SQL query with promise
              const executeQuery = (sql: string, binds?: any[]): Promise<any[]> => {
                  return new Promise((resolveQuery, rejectQuery) => {
                      try {
                          connection.execute({
                              sqlText: sql,
                              binds: binds || [],
                              complete: (err: any, stmt: any, rows: any[]) => {
                                  if (err) {
                                      rejectQuery(err);
                                      return;
                                  }
                                  resolveQuery(rows || []);
                              }
                          });
                      } catch (err) {
                          rejectQuery(err);
                      }
                  });
              };
              
              // Connect and fetch schemas
              await new Promise<void>((resolve, reject) => {
                  connection.connect(async (err: any, conn: any) => {
                      if (err) {
                          try {
                              connection.destroy();
                          } catch (e) {
                              // Ignore destroy errors
                          }
                          reject(err);
                          return;
                      }
                      
                      try {
                          // Use SHOW SCHEMAS to get all schemas in the database
                          const schemasResult = await executeQuery('SHOW SCHEMAS');
                          
                          // Parse SHOW SCHEMAS result - it returns columns: created_on, name, database_name, etc.
                          const schemaList = schemasResult
                              .map((s: any) => (s.NAME || s.name || s.Name || '').toString())
                              .filter((name: string) => name && name.toUpperCase() !== 'INFORMATION_SCHEMA')
                              .sort();
                          
                          // Close connection
                          try {
                              connection.destroy();
                          } catch (e) {
                              // Ignore destroy errors
                          }
                          
                          res.json({ schemas: schemaList });
                          resolve();
                      } catch (error) {
                          try {
                              connection.destroy();
                          } catch (e) {
                              // Ignore destroy errors
                          }
                          reject(error);
                      }
                  });
              });
          } else {
              // If schema parameter is provided, return tables from that schema
              const sqlConnectionConfig: any = {
                  host: (host || server) as string,
                  server: server as string,
                  port: port ? parseInt(port as string, 10) : undefined,
                  database: database as string,
                  schema: schema as string,
                  schemas: schemas as string,
                  username: username as string,
                  password: password as string,
                  account: snowflakeAccount,
                  warehouse: warehouse as string
              };

              const tableSchemas = await fetchSnowflakeTableSchemas(sqlConnectionConfig);

              // Format for frontend
              const tables = tableSchemas.map((s: any) => ({
                  id: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
                  name: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
                  dataset: s.schemaName || '',
                  table: s.tableId,
                  fieldCount: s.schema.length,
                  rowCount: s.rowCount
              }));

              res.json({ tables });
          }
      } else if (sourceType === 'mysql') {
          // MySQL
          if (!database || !username || !password) {
              return res.status(400).json({ 
                  error: 'database, username, and password are required for MySQL' 
              });
          }

          const sqlConnectionConfig: any = {
              host: (host || server) as string,
              server: server as string,
              port: port ? parseInt(port as string, 10) : undefined,
              database: database as string,
              schema: schema as string,
              schemas: schemas as string,
              username: username as string,
              password: password as string
          };

          const tableSchemas = await fetchMySQLTableSchemas(sqlConnectionConfig);

          // Format for frontend
          const tables = tableSchemas.map((s: any) => ({
              id: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
              name: s.schemaName ? `${s.schemaName}.${s.tableId}` : s.tableId,
              dataset: s.schemaName || '',
              table: s.tableId,
              fieldCount: s.schema.length,
              rowCount: s.rowCount
          }));

          res.json({ tables });
      } else {
          return res.status(400).json({
              error: `Unsupported data source type: ${sourceType}`
          });
      }
  } catch (error) {
      console.error('Error fetching tables:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      res.status(500).json({ 
          error: `Failed to fetch tables: ${errorMessage}` 
      });
  }
});

// GET /api/rag/columns - Get columns for selected tables
app.get('/api/rag/columns', async (req, res) => {
  try {
      const { dataSourceType, projectId, serviceAccountKey, datasets, selectedTables,
              apiKey, baseId, host, server, serverUrl, port, database, username, password, schema,
              // Databricks specific fields
              connectionMethod, jdbcUrl, tokenName, token, accessToken, clientId, clientSecret, serverHostname, authMethod } = req.query;
      
      if (!dataSourceType || typeof dataSourceType !== 'string') {
          return res.status(400).json({ error: 'dataSourceType is required' });
      }
      const sourceType = dataSourceType as string;

      console.log(`[API /api/rag/columns] Called with sourceType: ${sourceType}, selectedTables: ${selectedTables}`);

      if (!selectedTables) {
          return res.status(400).json({ 
              error: 'selectedTables is required' 
          });
      }

      const tableList = (selectedTables as string).split(',').map(t => t.trim()).filter(t => t.length > 0);
      const columnsMap: { [tableId: string]: any[] } = {};
      
      console.log(`[API /api/rag/columns] Processing ${tableList.length} tables:`, tableList);

      if (sourceType === 'bigquery') {
          if (!projectId || !serviceAccountKey || !datasets) {
              return res.status(400).json({ 
                  error: 'projectId, serviceAccountKey, and datasets are required for BigQuery' 
              });
          }

          const { createBigQueryClient } = await import('./services/data_sources/bigquery.service');
          const client = createBigQueryClient({
              projectId: projectId as string,
              serviceAccountKey: serviceAccountKey as string
          });

          const datasetsArray = (datasets as string).split(',').map(d => d.trim());

          for (const tableId of tableList) {
              const parts = tableId.split('.');
              if (parts.length === 2) {
                  const [datasetId, tableName] = parts;
                  if (datasetsArray.includes(datasetId)) {
                      try {
                          const table = client.dataset(datasetId).table(tableName);
                          const [metadata] = await table.getMetadata();
                          const schema = metadata.schema?.fields || [];
                          
                          columnsMap[tableId] = schema.map((field: any) => ({
                              name: field.name,
                              type: field.type,
                              mode: field.mode || 'NULLABLE',
                              description: field.description || ''
                          }));
                      } catch (err) {
                          console.error(`Error fetching columns for ${tableId}:`, err);
                          columnsMap[tableId] = [];
                      }
                  }
              }
          }
      } else if (sourceType === 'airtable') {
          if (!apiKey || !baseId) {
              return res.status(400).json({ 
                  error: 'apiKey and baseId are required for Airtable' 
              });
          }

          const { createAirtableClient } = await import('./services/data_sources/airtable.service');
          const airtableClient = createAirtableClient({
              apiKey: apiKey as string,
              baseId: baseId as string
          });

          for (const tableName of tableList) {
              try {
                  const schema = await airtableClient.getTableSchemaDetailed(tableName);
                  columnsMap[tableName] = schema.fields.map((field: any) => ({
                      name: field.name,
                      type: field.type,
                      description: field.description || ''
                  }));
              } catch (err) {
                  console.error(`Error fetching columns for ${tableName}:`, err);
                  columnsMap[tableName] = [];
              }
          }
      } else if (sourceType === 'databricks') {
          // Databricks
          const connMethod = (connectionMethod as string) || 'url';
          if (connMethod === 'url') {
              if (!database || !jdbcUrl || !tokenName || (!token && !accessToken)) {
                  return res.status(400).json({ 
                      error: 'database, jdbcUrl, tokenName, and token are required for Databricks URL connection' 
                  });
              }
          } else {
              if (!database || !clientId || !clientSecret) {
                  return res.status(400).json({ 
                      error: 'database, clientId, and clientSecret are required for Databricks Client connection' 
                  });
              }
          }

          // Databricks uses SQL REST API
          const axios = require('axios');
          
          // Parse connection configuration
          let serverHostname: string;
          let httpPath: string;
          let databricksToken: string;
          
          if (connMethod === 'url') {
              // URL connection: parse JDBC URL
              // Parse JDBC URL
              const jdbcMatch = (jdbcUrl as string).match(/jdbc:databricks:\/\/([^:]+):(\d+)\/([^;]+)/);
              if (!jdbcMatch) {
                  return res.status(400).json({ 
                      error: 'Invalid JDBC URL format' 
                  });
              }
              serverHostname = jdbcMatch[1];
              const httpPathMatch = (jdbcUrl as string).match(/httpPath=([^;]+)/);
              httpPath = httpPathMatch ? httpPathMatch[1] : '/sql/1.0/warehouses/default';
              databricksToken = (token || accessToken) as string;
          } else {
              // Client connection - not yet fully supported for column fetching
              return res.status(400).json({ 
                  error: 'Databricks Client connection for column fetching is not yet implemented. Please use URL connection.' 
              });
          }
          
          // Extract warehouse ID from httpPath
          const warehouseIdMatch = httpPath.match(/warehouses\/([^\/]+)/);
          const warehouseId = warehouseIdMatch ? warehouseIdMatch[1] : null;
          
          if (!warehouseId) {
              return res.status(400).json({ 
                  error: 'Could not extract warehouse ID from httpPath' 
              });
          }
          
          const statementsUrl = `https://${serverHostname}/api/2.0/sql/statements`;
          
          // Helper function to execute SQL query
          const executeSQL = async (sql: string): Promise<any[]> => {
              const response = await axios.post(statementsUrl, {
                  warehouse_id: warehouseId,
                  statement: sql,
                  wait_timeout: '30s',
                  on_wait_timeout: 'CANCEL'
              }, {
                  headers: {
                      'Authorization': `Bearer ${databricksToken}`,
                      'Content-Type': 'application/json'
                  },
                  timeout: 60000
              });
              
              let statementId = response.data.statement_id;
              let status = response.data.status?.state;
              let statusResponse: any = response.data;
              let attempts = 0;
              const maxAttempts = 60;
              
              if (status === 'SUCCEEDED' && (response.data.result || response.data.manifest)) {
                  // Already completed
              } else {
                  while ((status === 'PENDING' || status === 'RUNNING') && attempts < maxAttempts) {
                      await new Promise(resolve => setTimeout(resolve, 1000));
                      attempts++;
                      const pollResponse = await axios.get(`${statementsUrl}/${statementId}`, {
                          headers: {
                              'Authorization': `Bearer ${databricksToken}`,
                              'Content-Type': 'application/json'
                          },
                          timeout: 30000
                      });
                      statusResponse = pollResponse.data;
                      status = statusResponse.status?.state;
                      if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED') {
                          break;
                      }
                  }
              }
              
              if (status === 'SUCCEEDED') {
                  let resultData = statusResponse.result;
                  let manifest = statusResponse.manifest;
                  
                  if (!resultData && statusResponse.result) {
                      resultData = statusResponse.result;
                  }
                  
                  const data = resultData?.data_array || resultData?.data || [];
                  
                  if (manifest && manifest.schema && manifest.schema.columns && data.length > 0) {
                      const columns = manifest.schema.columns.map((col: any) => col.name);
                      return data.map((row: any[]) => {
                          const obj: any = {};
                          columns.forEach((col: string, idx: number) => {
                              obj[col] = row[idx];
                          });
                          return obj;
                      });
                  }
                  
                  return data;
              } else if (status === 'FAILED' || status === 'CANCELED') {
                  const errorMessage = statusResponse.status?.error?.message || 'Unknown error';
                  throw new Error(`SQL query failed: ${errorMessage}`);
              } else {
                  throw new Error(`SQL query timed out with status: ${status}`);
              }
          };
          
          // Use workspace catalog and default schema
          const catalogName = 'workspace';
          const defaultSchema = (schema as string) || 'default';
          
          console.log(`[Databricks Columns] Fetching columns for ${tableList.length} tables`);
          console.log(`[Databricks Columns] Table list:`, tableList);
          
          // Fetch columns for each table
          for (const tableId of tableList) {
              try {
                  const parts = tableId.split('.');
                  // For Databricks, table ID format is: catalog.schema.table (3 parts)
                  // Extract catalog, schema, and table name
                  let catalogNameToUse = catalogName;
                  let schemaNameToUse = defaultSchema;
                  let tableName: string;
                  
                  if (parts.length === 3) {
                      // Format: catalog.schema.table
                      catalogNameToUse = parts[0];
                      schemaNameToUse = parts[1];
                      tableName = parts[2];
                  } else if (parts.length === 2) {
                      // Format: schema.table (fallback for backward compatibility)
                      schemaNameToUse = parts[0];
                      tableName = parts[1];
                  } else if (parts.length === 1) {
                      // Format: table (just table name)
                      tableName = parts[0];
                  } else {
                      // Invalid format, try to use last part as table name
                      tableName = parts[parts.length - 1];
                      if (parts.length >= 2) {
                          schemaNameToUse = parts[parts.length - 2];
                      }
                      if (parts.length >= 3) {
                          catalogNameToUse = parts[parts.length - 3];
                      }
                  }
                  
                  console.log(`[Databricks Columns] Processing table ID: ${tableId}`);
                  console.log(`[Databricks Columns] Parsed - catalog: ${catalogNameToUse}, schema: ${schemaNameToUse}, table: ${tableName}`);
                  
                  // Try DESCRIBE TABLE first (Databricks native command)
                  // This works across all catalogs without needing USE CATALOG
                  let columnsResult: any[] = [];
                  const fullyQualifiedTable = `\`${catalogNameToUse}\`.\`${schemaNameToUse}\`.\`${tableName}\``;
                  
                  try {
                      console.log(`[Databricks Columns] Trying DESCRIBE TABLE for: ${fullyQualifiedTable}`);
                      const describeResult = await executeSQL(`DESCRIBE TABLE ${fullyQualifiedTable}`);
                      console.log(`[Databricks Columns] DESCRIBE TABLE result:`, describeResult);
                      
                      // DESCRIBE TABLE returns columns with: col_name, data_type, comment
                      // Map to our expected format
                      columnsResult = describeResult.map((row: any) => ({
                          column_name: row.col_name || row.column_name || row.COL_NAME || row['col_name'],
                          data_type: row.data_type || row.DATA_TYPE || row['data_type'] || 'STRING',
                          is_nullable: row.nullable || row.is_nullable || row.IS_NULLABLE || 'YES',
                          column_comment: row.comment || row.COMMENT || row['comment'] || ''
                      }));
                      
                      console.log(`[Databricks Columns] Mapped ${columnsResult.length} columns from DESCRIBE TABLE`);
                  } catch (describeError: any) {
                      console.warn(`[Databricks Columns] DESCRIBE TABLE failed, trying SHOW COLUMNS:`, describeError.message);
                      
                      // Try SHOW COLUMNS as alternative
                      try {
                          const showColumnsResult = await executeSQL(`SHOW COLUMNS IN ${fullyQualifiedTable}`);
                          console.log(`[Databricks Columns] SHOW COLUMNS result:`, showColumnsResult);
                          
                          // SHOW COLUMNS returns similar structure to DESCRIBE
                          columnsResult = showColumnsResult.map((row: any) => ({
                              column_name: row.col_name || row.column_name || row.COL_NAME || row['col_name'],
                              data_type: row.data_type || row.DATA_TYPE || row['data_type'] || 'STRING',
                              is_nullable: row.nullable || row.is_nullable || row.IS_NULLABLE || 'YES',
                              column_comment: row.comment || row.COMMENT || row['comment'] || ''
                          }));
                          
                          console.log(`[Databricks Columns] Mapped ${columnsResult.length} columns from SHOW COLUMNS`);
                      } catch (showColumnsError: any) {
                          console.warn(`[Databricks Columns] SHOW COLUMNS failed, trying information_schema with USE CATALOG:`, showColumnsError.message);
                          
                          // Fallback: Set catalog context, then query information_schema
                          // Note: These are separate calls, so catalog context might not persist
                          try {
                              await executeSQL(`USE CATALOG ${catalogNameToUse.replace(/`/g, '')}`);
                              console.log(`[Databricks Columns] Set catalog context to: ${catalogNameToUse}`);
                          } catch (useCatalogError: any) {
                              console.warn(`[Databricks Columns] USE CATALOG failed:`, useCatalogError.message);
                          }
                          
                          // Query information_schema with catalog filter
                          const columnsQuery = `
                              SELECT 
                                  column_name as column_name,
                                  data_type as data_type,
                                  is_nullable as is_nullable,
                                  comment as column_comment
                              FROM information_schema.columns
                              WHERE table_catalog = '${catalogNameToUse.replace(/'/g, "''")}'
                                AND table_schema = '${schemaNameToUse.replace(/'/g, "''")}'
                                AND table_name = '${tableName.replace(/'/g, "''")}'
                              ORDER BY ordinal_position
                          `;
                          
                          console.log(`[Databricks Columns] Executing information_schema query for catalog: ${catalogNameToUse}, schema: ${schemaNameToUse}, table: ${tableName}`);
                          columnsResult = await executeSQL(columnsQuery);
                      }
                  }
                  console.log(`[Databricks Columns] Got ${columnsResult.length} columns for ${tableId}`);
                  
                  columnsMap[tableId] = columnsResult.map((row: any) => ({
                      name: row.column_name || row.COLUMN_NAME,
                      type: row.data_type || row.DATA_TYPE || 'STRING',
                      nullable: (row.is_nullable || row.IS_NULLABLE) === 'YES',
                      description: row.column_comment || row.comment || row.COMMENT || ''
                  }));
                  console.log(`[Databricks Columns] Mapped ${columnsMap[tableId].length} columns for ${tableId}`);
              } catch (err) {
                  console.error(`[Databricks Columns] Error fetching columns for ${tableId}:`, err);
                  columnsMap[tableId] = [];
              }
          }
          
          console.log(`[Databricks Columns] Returning columns for ${Object.keys(columnsMap).length} tables`);
      } else if (sourceType === 'postgres' || sourceType === 'postgresql') {
          // PostgreSQL
          if (!database || !username || !password) {
              return res.status(400).json({ 
                  error: 'database, username, and password are required for PostgreSQL' 
              });
          }

          const { Client } = await import('pg');
          const pgClientConfig: any = {
              host: (host || server) as string,
              port: port ? parseInt(port as string, 10) : 5432,
              database: database as string,
              user: username as string,
              password: password as string,
              connectionTimeoutMillis: 30000 // 30 seconds
          };
          const client = new Client(pgClientConfig);

          try {
              await client.connect();

              for (const tableId of tableList) {
                  try {
                      const parts = tableId.split('.');
                      const schemaName = parts.length === 2 ? parts[0] : ((schema as string) || 'public');
                      const tableName = parts.length === 2 ? parts[1] : parts[0];

                      const query = `
                          SELECT 
                              column_name,
                              data_type,
                              is_nullable,
                              column_default
                          FROM information_schema.columns
                          WHERE table_schema = $1 AND table_name = $2
                          ORDER BY ordinal_position
                      `;
                      
                      const result = await client.query(query, [schemaName, tableName]);
                      columnsMap[tableId] = result.rows.map((col: any) => ({
                          name: col.column_name,
                          type: col.data_type,
                          nullable: col.is_nullable === 'YES',
                          default: col.column_default
                      }));
                  } catch (err) {
                      console.error(`Error fetching columns for ${tableId}:`, err);
                      columnsMap[tableId] = [];
                  }
              }
          } finally {
              await client.end();
          }
      } else if (sourceType === 'redshift') {
          // Redshift
          const redshiftUsesPgPass = String(authMethod || '').toLowerCase() === 'pgpass';
          if (!username || (!redshiftUsesPgPass && !password)) {
              return res.status(400).json({ 
                  error: redshiftUsesPgPass
                    ? 'username is required for Redshift'
                    : 'username and password are required for Redshift'
              });
          }

          const { Client } = await import('pg');
          const { parseRedshiftJDBCUrl } = await import('./services/data_sources/redshift.service');
          
          let redshiftHost = (host || server || serverUrl) as string;
          let redshiftPort = port ? parseInt(port as string, 10) : 5439;
          let redshiftDatabase = database as string;
          
          // If connectionMethod is 'url' or host looks like JDBC URL, parse it
          if (connectionMethod === 'url' || (redshiftHost && redshiftHost.startsWith('jdbc:redshift://'))) {
              try {
                  const parsed = parseRedshiftJDBCUrl(redshiftHost);
                  redshiftHost = parsed.host;
                  redshiftPort = parsed.port;
                  // Only override database if not explicitly provided
                  if (!redshiftDatabase && parsed.database) {
                      redshiftDatabase = parsed.database;
                  }
              } catch (error) {
                  return res.status(400).json({ 
                      error: `Failed to parse Redshift JDBC URL: ${error instanceof Error ? error.message : String(error)}` 
                  });
              }
          }
          
          if (!redshiftHost || !redshiftDatabase) {
              return res.status(400).json({ 
                  error: 'host and database are required for Redshift' 
              });
          }
          
          const pgClientConfig: any = {
              host: redshiftHost,
              port: redshiftPort,
              database: redshiftDatabase,
              user: username as string,
              connectionTimeoutMillis: 30000, // 30 seconds
              ssl: {
                  rejectUnauthorized: false // AWS Redshift uses self-signed certificates
              }
          };
          if (password) {
              pgClientConfig.password = password as string;
          }
          const client = new Client(pgClientConfig);

          try {
              await client.connect();

              for (const tableId of tableList) {
                  try {
                      const parts = tableId.split('.');
                      const schemaName = parts.length === 2 ? parts[0] : ((schema as string) || 'public');
                      const tableName = parts.length === 2 ? parts[1] : parts[0];

                      const query = `
                          SELECT 
                              column_name,
                              data_type,
                              is_nullable,
                              column_default
                          FROM information_schema.columns
                          WHERE table_schema = $1 AND table_name = $2
                          ORDER BY ordinal_position
                      `;
                      
                      const result = await client.query(query, [schemaName, tableName]);
                      columnsMap[tableId] = result.rows.map((col: any) => ({
                          name: col.column_name,
                          type: col.data_type,
                          nullable: col.is_nullable === 'YES',
                          default: col.column_default
                      }));
                  } catch (err) {
                      console.error(`Error fetching columns for ${tableId}:`, err);
                      columnsMap[tableId] = [];
                  }
              }
          } finally {
              await client.end();
          }
      } else if (sourceType === 'azure' || sourceType === 'sqlserver') {
          // Azure SQL Server / SQL Server
          if (!database || !username || !password) {
              return res.status(400).json({ 
                  error: 'database, username, and password are required for Azure SQL Server / SQL Server' 
              });
          }

          const sql = require('mssql');
          const { createSQLServerClient } = await import('./services/data_sources/azuresql.service');
          const sqlConfig = createSQLServerClient({
              server: (server || host) as string,
              host: (host || server) as string,
              database: database as string,
              username: username as string,
              password: password as string,
              schema: schema as string,
              port: port ? parseInt(port as string, 10) : undefined
          });
          
          let pool: any = null;
          try {
              pool = await sql.connect(sqlConfig);

              for (const tableId of tableList) {
                  try {
                      const parts = tableId.split('.');
                      const schemaName = parts.length === 2 ? parts[0] : ((schema as string) || 'dbo');
                      const tableName = parts.length === 2 ? parts[1] : parts[0];

                      const query = `
                          SELECT 
                              column_name,
                              data_type,
                              is_nullable,
                              column_default
                          FROM information_schema.columns
                          WHERE table_schema = @schema AND table_name = @table
                          ORDER BY ordinal_position
                      `;
                      
                      const request = pool.request();
                      request.input('schema', sql.NVarChar, schemaName);
                      request.input('table', sql.NVarChar, tableName);
                      const result = await request.query(query);
                      
                      columnsMap[tableId] = result.recordset.map((col: any) => ({
                          name: col.column_name,
                          type: col.data_type,
                          nullable: col.is_nullable === 'YES',
                          default: col.column_default
                      }));
                  } catch (err) {
                      console.error(`Error fetching columns for ${tableId}:`, err);
                      columnsMap[tableId] = [];
                  }
              }
          } finally {
              if (pool) {
                  try {
                      await pool.close();
                  } catch (err) {
                      console.warn('Error closing Azure SQL connection:', err);
                  }
              }
          }
      } else if (sourceType === 'snowflake') {
          // Snowflake
          const snowflakeAccount = (req.query.account as string) || (host as string) || (server as string);
          const snowflakeWarehouse = req.query.warehouse as string;
          if (!snowflakeAccount || !snowflakeWarehouse || !database || !username || !password) {
              return res.status(400).json({ 
                  error: 'Account (or host/server), Warehouse, Database, Username, and Password are required for Snowflake' 
              });
          }

          let snowflake: any;
          try {
              snowflake = require('snowflake-sdk');
          } catch (error) {
              return res.status(400).json({ 
                  error: 'Snowflake SDK (snowflake-sdk) is required for Snowflake column fetching. Please install it: npm install snowflake-sdk' 
              });
          }

          // Normalize account input from host/account fields.
          const cleanAccount = normalizeSnowflakeAccountInput(snowflakeAccount);

          const connectionConfig_snowflake = {
              account: cleanAccount,
              username: username as string,
              password: password as string,
              warehouse: snowflakeWarehouse,
              database: database as string,
              schema: (schema as string) || 'PUBLIC',
              role: undefined
          };

          console.log(`[Snowflake Columns] Connecting to account: ${cleanAccount}, warehouse: ${snowflakeWarehouse}, database: ${database}, schema: ${connectionConfig_snowflake.schema}`);

          // Create connection
          const connection = snowflake.createConnection(connectionConfig_snowflake);

          // Helper function to execute SQL query with promise
          const executeQuery = (sql: string, binds?: any[]): Promise<any[]> => {
              return new Promise((resolveQuery, rejectQuery) => {
                  try {
                      connection.execute({
                          sqlText: sql,
                          binds: binds || [],
                          complete: (err: any, stmt: any, rows: any[]) => {
                              if (err) {
                                  console.error(`[Snowflake Columns] Query error:`, err);
                                  rejectQuery(err);
                                  return;
                              }
                              resolveQuery(rows || []);
                          }
                      });
                  } catch (err) {
                      rejectQuery(err);
                  }
              });
          };

          // Connect and execute queries using a promise wrapper
          await new Promise<void>((resolve, reject) => {
              let responseSent = false;
              const sendResponse = (status: number, data: any) => {
                  if (responseSent) return;
                  responseSent = true;
                  if (status === 200) {
                      res.json(data);
                  } else {
                      res.status(status).json(data);
                  }
                  resolve();
              };

              connection.connect(async (err: any, conn: any) => {
                  if (err) {
                      console.error('[Snowflake Columns] Connection error:', err);
                      sendResponse(500, { 
                          error: `Failed to connect to Snowflake: ${err.message}` 
                      });
                      return;
                  }

                  console.log('[Snowflake Columns] Connected successfully');

                  try {
                      // Database and schema are already set in connection config
                      // Fetch columns for each table
                      for (const tableId of tableList) {
                          try {
                              const parts = tableId.split('.');
                              const schemaName = parts.length === 2 ? parts[0] : (connectionConfig_snowflake.schema || 'PUBLIC');
                              const tableName = parts.length === 2 ? parts[1] : parts[0];

                              console.log(`[Snowflake Columns] Fetching columns for ${schemaName}.${tableName}`);

                              // Try SHOW COLUMNS first, fallback to INFORMATION_SCHEMA
                              let columns: any[] = [];
                              try {
                                  const showColumnsQuery = `SHOW COLUMNS IN TABLE ${schemaName}.${tableName}`;
                                  console.log(`[Snowflake Columns] Trying SHOW COLUMNS: ${showColumnsQuery}`);
                                  columns = await executeQuery(showColumnsQuery);

                                  // Check if result is valid
                                  if (!columns || columns.length === 0 || !columns[0] || (!columns[0].COLUMN_NAME && !columns[0].column_name && !columns[0]['column name'])) {
                                      throw new Error('SHOW COLUMNS returned unexpected format');
                                  }
                              } catch (showErr) {
                                  console.log(`[Snowflake Columns] SHOW COLUMNS failed, trying INFORMATION_SCHEMA:`, showErr);
                                  // Fallback to INFORMATION_SCHEMA
                                  const infoSchemaQuery = `
                                      SELECT 
                                          COLUMN_NAME as column_name,
                                          DATA_TYPE as data_type,
                                          IS_NULLABLE as is_nullable,
                                          COLUMN_DEFAULT as column_default,
                                          CHARACTER_MAXIMUM_LENGTH as character_maximum_length,
                                          NUMERIC_PRECISION as numeric_precision,
                                          NUMERIC_SCALE as numeric_scale,
                                          COMMENT as comment
                                      FROM INFORMATION_SCHEMA.COLUMNS
                                      WHERE UPPER(TABLE_SCHEMA) = UPPER(?) AND UPPER(TABLE_NAME) = UPPER(?)
                                      ORDER BY ORDINAL_POSITION
                                  `;
                                  columns = await executeQuery(infoSchemaQuery, [schemaName, tableName]);
                              }

                              // Parse columns - handle both SHOW COLUMNS and INFORMATION_SCHEMA formats
                              columnsMap[tableId] = columns.map((col: any) => {
                                  const columnName = (col.COLUMN_NAME || col.column_name || col.Column_Name || col['column name'] || col.name || '').toString();
                                  let dataType = (col.DATA_TYPE || col.data_type || col.Data_Type || col['data type'] || col.type || '').toString();
                                  const isNullable = (col.IS_NULLABLE || col.is_nullable || col.Is_Nullable || col['is nullable'] || col.nullable || '').toString();
                                  const charMaxLength = col.CHARACTER_MAXIMUM_LENGTH !== undefined && col.CHARACTER_MAXIMUM_LENGTH !== null
                                      ? col.CHARACTER_MAXIMUM_LENGTH
                                      : (col.character_maximum_length !== undefined && col.character_maximum_length !== null ? col.character_maximum_length : undefined);
                                  const numericPrecision = col.NUMERIC_PRECISION !== undefined && col.NUMERIC_PRECISION !== null 
                                      ? col.NUMERIC_PRECISION 
                                      : (col.numeric_precision !== undefined && col.numeric_precision !== null ? col.numeric_precision : null);
                                  const numericScale = col.NUMERIC_SCALE !== undefined && col.NUMERIC_SCALE !== null 
                                      ? col.NUMERIC_SCALE 
                                      : (col.numeric_scale !== undefined && col.numeric_scale !== null ? col.numeric_scale : null);
                                  const comment = col.COMMENT || col.comment || col.Comment || col['comment'] || '';

                                  // Build type string with precision/scale/length
                                  if (charMaxLength) {
                                      dataType += `(${charMaxLength})`;
                                  } else if (numericPrecision !== null && numericScale !== null) {
                                      dataType += `(${numericPrecision},${numericScale})`;
                                  } else if (numericPrecision !== null) {
                                      dataType += `(${numericPrecision})`;
                                  }

                                  return {
                                      name: columnName,
                                      type: dataType,
                                      nullable: isNullable === 'YES' || isNullable === 'Y' || isNullable === true,
                                      default: col.COLUMN_DEFAULT || col.column_default || col['column default'] || undefined,
                                      description: comment || undefined
                                  };
                              }).filter((col: any) => col.name); // Filter out any entries without a name

                              console.log(`[Snowflake Columns] Fetched ${columnsMap[tableId].length} columns for ${tableId}`);
                          } catch (err) {
                              console.error(`[Snowflake Columns] Error fetching columns for ${tableId}:`, err);
                              columnsMap[tableId] = [];
                          }
                      }

                      // Close connection
                      try {
                          connection.destroy((err: any) => {
                              if (err) {
                                  console.warn('[Snowflake Columns] Error destroying connection:', err);
                              }
                          });
                      } catch (e) {
                          console.warn('[Snowflake Columns] Error closing connection:', e);
                      }

                      // Send response
                      sendResponse(200, { columns: columnsMap });
                  } catch (error) {
                      console.error('[Snowflake Columns] Error processing columns:', error);
                      try {
                          connection.destroy();
                      } catch (e) {
                          // Ignore destroy errors
                      }
                      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
                      sendResponse(500, { 
                          error: `Failed to fetch Snowflake columns: ${errorMessage}` 
                      });
                  }
              });
          });

          // Return - response already sent from promise
          return;
      } else if (sourceType === 'mysql') {
          // MySQL
          if (!database || !username || !password) {
              return res.status(400).json({ 
                  error: 'database, username, and password are required for MySQL' 
              });
          }

          const mysql = require('mysql2/promise');
          const mysqlConfig: any = {
              host: (host || server || serverUrl) as string,
              port: port ? parseInt(port as string, 10) : 3306,
              database: database as string,
              user: username as string,
              password: password as string,
              connectTimeout: 30000 // 30 seconds
          };

          let connection: any = null;
          try {
              connection = await mysql.createConnection(mysqlConfig);

              for (const tableId of tableList) {
                  try {
                      const parts = tableId.split('.');
                      const schemaName = parts.length === 2 ? parts[0] : ((schema as string) || database as string);
                      const tableName = parts.length === 2 ? parts[1] : parts[0];

                      const query = `
                          SELECT 
                              column_name as column_name,
                              data_type as data_type,
                              is_nullable as is_nullable,
                              column_default as column_default,
                              character_maximum_length as character_maximum_length,
                              numeric_precision as numeric_precision,
                              numeric_scale as numeric_scale
                          FROM information_schema.columns
                          WHERE table_schema = ? AND table_name = ?
                          ORDER BY ordinal_position
                      `;

                      const [result] = await connection.execute(query, [schemaName, tableName]);
                      columnsMap[tableId] = (result as any[]).map((col: any) => {
                          let type = col.data_type;
                          if (col.character_maximum_length) {
                              type += `(${col.character_maximum_length})`;
                          } else if (col.numeric_precision !== null && col.numeric_scale !== null) {
                              type += `(${col.numeric_precision},${col.numeric_scale})`;
                          } else if (col.numeric_precision !== null) {
                              type += `(${col.numeric_precision})`;
                          }

                          return {
                              name: col.column_name,
                              type: type,
                              nullable: col.is_nullable === 'YES',
                              default: col.column_default
                          };
                      });
                  } catch (err) {
                      console.error(`Error fetching columns for ${tableId}:`, err);
                      columnsMap[tableId] = [];
                  }
              }
          } finally {
              if (connection) {
                  await connection.end();
              }
          }
      } else {
          // Unknown data source type
          return res.status(400).json({ 
              error: `Unsupported data source type: ${sourceType}` 
          });
      }

      res.json({ columns: columnsMap });
  } catch (error) {
      console.error('Error fetching columns:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      res.status(500).json({ 
          error: `Failed to fetch columns: ${errorMessage}` 
      });
  }
});

// POST /api/rag/create - Create Knowledge Base
app.post('/api/rag/create', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      const { dataSourceType, projectId, serviceAccountKey, datasets, selectedTables, selectedColumns,
              apiKey: airtableApiKey, baseId, host, server, serverUrl, port, database, username, password, 
              schema, schemas, catalog, account, warehouse, httpPath, accessToken, openaiApiKey, geminiApiKey,
              mergeMode, columnDescriptionMode, workspaceName: workspaceNameBody,
      // Databricks specific fields
      connectionMethod, jdbcUrl, tokenName, token, clientId, clientSecret, serverHostname, authMethod } = req.body;
      let llmProvider = req.body.llmProvider;
      const reqLlmApiKey = req.body.llmApiKey;
      const reqLlmModel = req.body.llmModel;
      
      if (!dataSourceType) {
          return res.status(400).json({ error: 'dataSourceType is required' });
      }
      const sourceType = dataSourceType;

      let connectionConfig: any;
      let datasetsArray: string[] = [];
      let tablesArray: string[];

      if (sourceType === 'airtable') {
          if (!airtableApiKey || !baseId || !selectedTables) {
              return res.status(400).json({ 
                  error: 'apiKey, baseId, and selectedTables are required for Airtable' 
              });
          }
          connectionConfig = {
              apiKey: airtableApiKey,
              baseId: baseId
          };
          tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      } else if (sourceType === 'bigquery') {
          // BigQuery
          if (!projectId || !serviceAccountKey || !datasets || !selectedTables) {
              return res.status(400).json({ 
                  error: 'projectId, serviceAccountKey, datasets, and selectedTables are required for BigQuery' 
              });
          }
          connectionConfig = {
              projectId,
              serviceAccountKey
          };
          datasetsArray = Array.isArray(datasets) ? datasets : datasets.split(',').map((d: string) => d.trim());
          tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      } else if (sourceType === 'databricks') {
          // Databricks
          const connMethod = connectionMethod || 'url';
          if (connMethod === 'host') {
              // Client connection: requires database, clientId, and clientSecret
              if (!database || !clientId || !clientSecret || !selectedTables) {
                  return res.status(400).json({ 
                      error: 'database, clientId, clientSecret, and selectedTables are required for Databricks Client connection' 
                  });
              }
          } else {
              // URL connection: requires database, jdbcUrl, tokenName, and token
              if (!database || !jdbcUrl || !tokenName || (!token && !accessToken) || !selectedTables) {
                  return res.status(400).json({ 
                      error: 'database, jdbcUrl, tokenName, token, and selectedTables are required for Databricks URL connection' 
                  });
              }
          }

          connectionConfig = {
              host: host || server,
              server: server,
              port: port ? parseInt(port, 10) : undefined,
              database,
              catalog,
              schema,
              schemas,
              connectionMethod: connectionMethod || 'url'
          };

          if (connectionConfig.connectionMethod === 'host') {
              connectionConfig.serverHostname = serverHostname || host || server;
              connectionConfig.clientId = clientId;
              connectionConfig.clientSecret = clientSecret;
          } else {
              connectionConfig.jdbcUrl = jdbcUrl;
              connectionConfig.tokenName = tokenName;
              connectionConfig.token = token || accessToken;
              connectionConfig.accessToken = token || accessToken;
          }

          tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      } else if (sourceType === 'postgres' || sourceType === 'postgresql') {
          // PostgreSQL
          if (!database || !username || !password || !selectedTables) {
              return res.status(400).json({ 
                  error: 'database, username, password, and selectedTables are required for PostgreSQL' 
              });
          }

          connectionConfig = {
              host: host || server || serverUrl,
              server: server,
              serverUrl: serverUrl,
              port: port ? parseInt(port, 10) : undefined,
              database,
              schema,
              schemas,
              username,
              password,
              authMethod,
              connectionMethod
          };

          tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      } else if (sourceType === 'redshift') {
          // Redshift
          const connMethod = connectionMethod || 'host';
          const redshiftHost = host || server || serverUrl || jdbcUrl;
          const redshiftUsesPgPass = String(authMethod || '').toLowerCase() === 'pgpass';
          if (!username || (!redshiftUsesPgPass && !password) || !selectedTables) {
              return res.status(400).json({ 
                  error: redshiftUsesPgPass
                      ? 'username and selectedTables are required for Redshift'
                      : 'username, password, and selectedTables are required for Redshift'
              });
          }
          if (connMethod !== 'url' && !database) {
              return res.status(400).json({
                  error: 'database is required for Redshift host connection mode'
              });
          }
          if (!redshiftHost) {
              return res.status(400).json({
                  error: 'host/server/serverUrl or jdbcUrl is required for Redshift'
              });
          }

          connectionConfig = {
              host: host || server || serverUrl,
              server: server,
              serverUrl: serverUrl,
              port: port ? parseInt(port, 10) : undefined,
              database,
              schema,
              schemas, // Comma-separated list of schemas (similar to datasets for BigQuery)
              username,
              password,
              authMethod,
              connectionMethod: connMethod,
              jdbcUrl
          };

          tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      } else if (sourceType === 'azure' || sourceType === 'sqlserver') {
          // Azure SQL Server / SQL Server
          if (!database || !username || !password || !selectedTables) {
              return res.status(400).json({ 
                  error: 'database, username, password, and selectedTables are required for Azure SQL Server / SQL Server' 
              });
          }

          connectionConfig = {
              host: host || server,
              server: server || serverUrl,
              serverUrl: serverUrl,
              port: port ? parseInt(port, 10) : undefined,
              database,
              schema,
              schemas, // Comma-separated list of schemas (similar to datasets for BigQuery)
              username,
              password,
              authMethod,
              connectionMethod
          };

          tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      } else if (sourceType === 'snowflake') {
          // Snowflake
          if (!database || !username || !password || !account || !warehouse || !selectedTables) {
              return res.status(400).json({ 
                  error: 'database, username, password, account, warehouse, and selectedTables are required for Snowflake' 
              });
          }

          connectionConfig = {
              host: host || server,
              server: server,
              database,
              schema,
              schemas,
              account,
              warehouse,
              username,
              password,
              authMethod,
              connectionMethod
          };

          tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      } else if (sourceType === 'mysql') {
          // MySQL
          if (!database || !username || !password || !selectedTables) {
              return res.status(400).json({ 
                  error: 'database, username, password, and selectedTables are required for MySQL' 
              });
          }

          connectionConfig = {
              host: host || server,
              server: server,
              port: port ? parseInt(port, 10) : undefined,
              database,
              schema,
              username,
              password
          };

          tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      } else {
          // Unknown data source type
          return res.status(400).json({ 
              error: `Unsupported data source type: ${sourceType}` 
          });
      }

      // Get user info once (needed for table limit check and Knowledge Base creation)
      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      // Check table limit before creating Knowledge Base
      // Need to count existing tables + new tables and check against limit
      try {
          // Get identifier for this data source (projectId, baseId, or database)
          let identifier: string;
          if (sourceType === 'airtable') {
              identifier = baseId || 'airtable';
          } else if (sourceType === 'bigquery') {
              identifier = projectId || 'bigquery';
          } else if (sourceType === 'databricks') {
              identifier = database || 'databricks';
          } else if (sourceType === 'postgres' || sourceType === 'postgresql') {
              identifier = database || 'postgres';
          } else if (sourceType === 'redshift') {
              identifier = database || 'redshift';
          } else if (sourceType === 'azure' || sourceType === 'sqlserver') {
              identifier = database || 'azure';
          } else if (sourceType === 'snowflake') {
              identifier = database || 'snowflake';
          } else if (sourceType === 'mysql') {
              identifier = database || 'mysql';
          } else {
              identifier = database || sourceType;
          }
          
          // Get existing Knowledge Base to count existing tables
          const existingIndex = await getRAGIndex(identifier, req.userId, userName);
          
          // Count existing tables for this data source
          let existingTableCount = 0;
          if (existingIndex && existingIndex.tables && Array.isArray(existingIndex.tables)) {
              existingTableCount = existingIndex.tables.length;
          }
          
          // Count new tables (excluding ones that already exist if we're merging)
          // replace_all: final table count = selected tables only
          // merge (default or replace_columns/add_columns): union of existing + new table ids
          let totalTables: number;
          let newTablesToAdd = 0;
          const isReplaceAll = mergeMode === 'replace_all';
          if (existingIndex && isReplaceAll) {
              totalTables = tablesArray.length;
              newTablesToAdd = Math.max(0, totalTables - existingTableCount);
          } else if (existingIndex) {
              const existingTableIds = new Set((existingIndex.tables as any[]).map((t: any) => t.id || t.name));
              newTablesToAdd = tablesArray.filter((tableId) => !existingTableIds.has(tableId)).length;
              totalTables = existingTableCount + newTablesToAdd;
          } else {
              totalTables = tablesArray.length;
              newTablesToAdd = tablesArray.length;
          }
          
          // Check limit with total count
          const limits = await subscriptionService.getPlanLimitsForUser(req.userId);
          const maxTablesPerDataSource = limits.maxTablesPerDataSource;
          
          if (maxTablesPerDataSource !== -1 && totalTables > maxTablesPerDataSource) {
              return res.status(403).json({
                  error: 'Table limit exceeded',
                  message: `You have reached your plan's table limit of ${maxTablesPerDataSource} per data source. Current: ${existingTableCount}, Trying to add: ${newTablesToAdd}, Total would be: ${totalTables}. Please upgrade your plan to add more tables.`,
                  limit: maxTablesPerDataSource,
                  current: existingTableCount,
                  adding: newTablesToAdd,
                  total: totalTables,
                  upgradeUrl: '/pricing'
              });
          }
          
          console.log(`Table limit check passed: existing=${existingTableCount}, adding=${newTablesToAdd}, total=${totalTables}, limit=${maxTablesPerDataSource === -1 ? 'unlimited' : maxTablesPerDataSource}`);
      } catch (error) {
          console.warn('Error checking table limit:', error);
          // Continue if limit check fails (don't block creation due to limit check errors)
      }

      const preferredProvider = parseLLMProviderString(
        typeof llmProvider === 'string' ? llmProvider : undefined
      );
      const requestApiKey =
          typeof reqLlmApiKey === 'string' && reqLlmApiKey.trim().length > 0 ? reqLlmApiKey.trim() : '';
      const requestModel =
          typeof reqLlmModel === 'string' && reqLlmModel.trim().length > 0 ? reqLlmModel.trim() : undefined;
      const llmConfig: LLMConfig | null =
          preferredProvider && requestApiKey
              ? {
                    provider: preferredProvider,
                    apiKey: requestApiKey,
                    model: requestModel,
                    useLightModel: false,
                }
              : await getLLMConfig(req.userId, preferredProvider);

      if (preferredProvider && requestApiKey) {
          console.log(
              `[LLM Config] source=request userId=${req.userId} provider=${preferredProvider} model=${requestModel || 'default'} endpoint=rag-create`
          );
      }
      
      if (!llmConfig) {
          return res.status(400).json({ 
              error: 'LLM API key is required. Configure LLM settings or set OPENAI_API_KEY, GEMINI_API_KEY, or ANTHROPIC_API_KEY.' 
          });
      }
      
      // Set provider and API key from config
      llmProvider = llmConfig.provider;
      const llmApiKey = llmConfig.apiKey;
      const llmModel = llmConfig.model; // Model name from config (e.g., from GEMINI_MODEL env var)
      
      // Set the LLM provider so that llm.queryLLM uses the correct provider
      llm.setProvider(llmProvider);
      
      console.log(`[RAG Create] Final API Key being used:`);
      console.log(`  - Provider: ${llmProvider}`);
      console.log(`  - Key length: ${llmApiKey.length} characters`);
      console.log(`  - Use light model: ${llmConfig.useLightModel}`);
      console.log(`  - Model: ${llmModel || 'default'}`);

      // Parse selectedColumns if provided (format: { [tableId: string]: string[] })
      // Note: userName is already fetched above in the table limit check section
      const columnsMap: { [tableId: string]: string[] } = selectedColumns || {};

      console.log(`[RAG Create] Creating Knowledge Base for ${sourceType} with connection config:`, {
          ...connectionConfig,
          password: connectionConfig.password ? '***' : undefined,
          clientSecret: connectionConfig.clientSecret ? '***' : undefined,
          token: connectionConfig.token ? '***' : undefined,
          accessToken: connectionConfig.accessToken ? '***' : undefined
      });

      const workspaceNameForRag =
          typeof workspaceNameBody === 'string' && workspaceNameBody.trim()
              ? workspaceNameBody.trim()
              : undefined;

      const { indexId, filePath } = await createRAGIndex(
          connectionConfig,
          datasetsArray,
          tablesArray,
          req.userId,
          sourceType as 'bigquery' | 'airtable' | 'redshift' | 'azure' | 'sqlserver' | 'snowflake' | 'mysql' | 'postgres' | 'postgresql' | 'databricks',
          llmConfig.provider,
          llmApiKey,
          userName,
          columnsMap,
          mergeMode as 'replace_all' | 'replace_columns' | 'add_columns' | undefined,
          columnDescriptionMode as 'generate' | 'metadata' | undefined,
          llmModel,
          workspaceNameForRag
      );

      res.json({ 
          success: true, 
          indexId, 
          filePath,
          message: `Knowledge Base created successfully with ${tablesArray.length} tables` 
      });
  } catch (error) {
      console.error('Error creating Knowledge Base:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      res.status(500).json({ 
          error: `Failed to create Knowledge Base: ${errorMessage}` 
      });
  }
});

// POST /api/rag/check-conflicts - Check for table/column conflicts before creating RAG
app.post('/api/rag/check-conflicts', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      const { dataSourceType, projectId, baseId, database, selectedTables, selectedColumns } = req.body;
      
      if (!dataSourceType) {
          return res.status(400).json({ error: 'dataSourceType is required' });
      }
      const sourceType = dataSourceType;

      // Get identifier based on data source type
      let identifier: string;
      if (sourceType === 'airtable') {
          identifier = baseId || '';
      } else if (sourceType === 'bigquery') {
          identifier = projectId || '';
      } else if (sourceType === 'databricks') {
          identifier = database || '';
      } else if (sourceType === 'postgres' || sourceType === 'postgresql') {
          identifier = database || '';
      } else if (sourceType === 'redshift') {
          identifier = database || '';
      } else if (sourceType === 'azure' || sourceType === 'sqlserver') {
          identifier = database || '';
      } else if (sourceType === 'snowflake') {
          identifier = database || '';
      } else if (sourceType === 'mysql') {
          identifier = database || '';
      } else {
          identifier = database || '';
      }

      if (!identifier) {
          return res.status(400).json({ error: 'Identifier is required' });
      }

      // Fetch user info to get name for folder lookup
      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      // Check if index exists
      const existingIndex = await getRAGIndex(identifier, req.userId, userName);
      
      if (!existingIndex) {
          return res.json({ 
              hasConflicts: false,
              conflicts: []
          });
      }

      // Load existing index data
      let existingData: any = null;
      try {
          existingData = JSON.parse(fs.readFileSync(existingIndex.filePath, 'utf-8'));
      } catch (err) {
          console.warn('Could not load existing index data:', err);
          return res.json({ 
              hasConflicts: false,
              conflicts: []
          });
      }

      // Check for conflicts
      const conflicts: Array<{
          tableId: string;
          tableName: string;
          existingColumns: string[];
          newColumns: string[];
          hasExistingColumns: boolean;
          hasNewColumns: boolean;
      }> = [];

      const tablesArray = Array.isArray(selectedTables) ? selectedTables : selectedTables.split(',').map((t: string) => t.trim());
      const columnsMap: { [tableId: string]: string[] } = selectedColumns || {};

      for (const tableId of tablesArray) {
          // Find existing table in index
          const existingTable = existingData.tables?.find((t: any) => {
              const existingTableId = t.id || (t.dataset && t.name ? `${t.dataset}.${t.name}` : t.name || '');
              return existingTableId === tableId;
          });

          if (existingTable) {
              // Get existing column names from keyColumns (preferred) or legacy columns / documents
              const kc = existingTable.keyColumns as Array<{ name?: string }> | undefined;
              let existingColumns: string[] =
                  Array.isArray(kc) && kc.length > 0
                      ? kc.map((c) => String(c.name || '')).filter(Boolean)
                      : (existingTable.columns as Array<{ name?: string }> | undefined)?.map((c) => String(c.name || '')).filter(Boolean) ||
                        [];

              if (existingColumns.length === 0 && Array.isArray(existingData.documents)) {
                  const existingDoc = existingData.documents?.find((d: any) => {
                      if (!d.metadata) return false;
                      const dataSourceType = d.metadata.dataSourceType || existingData.dataSourceType || 'bigquery';

                      if (dataSourceType === 'airtable') {
                          return d.metadata.tableId === tableId || d.metadata.tableId === existingTable.name;
                      } else if (dataSourceType === 'bigquery') {
                          const docId = `${d.metadata.datasetId || ''}.${d.metadata.tableId || ''}`;
                          return docId === tableId || d.metadata.tableId === existingTable.name;
                      } else if (dataSourceType === 'databricks') {
                          const docId = d.metadata.schemaName
                              ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                              : d.metadata.tableId;
                          return docId === tableId || d.metadata.tableId === existingTable.name;
                      } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
                          const docId = d.metadata.schemaName
                              ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                              : d.metadata.tableId;
                          return docId === tableId || d.metadata.tableId === existingTable.name;
                      } else if (dataSourceType === 'redshift') {
                          const docId = d.metadata.schemaName
                              ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                              : d.metadata.tableId;
                          return docId === tableId || d.metadata.tableId === existingTable.name;
                      } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
                          const docId = d.metadata.schemaName
                              ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                              : d.metadata.tableId;
                          return docId === tableId || d.metadata.tableId === existingTable.name;
                      } else if (dataSourceType === 'snowflake') {
                          const docId = d.metadata.schemaName
                              ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                              : d.metadata.tableId;
                          return docId === tableId || d.metadata.tableId === existingTable.name;
                      } else if (dataSourceType === 'mysql') {
                          const docId = d.metadata.schemaName
                              ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                              : d.metadata.tableId;
                          return docId === tableId || d.metadata.tableId === existingTable.name;
                      } else {
                          const docId = d.metadata.schemaName
                              ? `${d.metadata.schemaName}.${d.metadata.tableId}`
                              : d.metadata.tableId;
                          return docId === tableId || d.metadata.tableId === existingTable.name;
                      }
                  });
                  existingColumns = existingDoc?.metadata?.schema?.map((col: any) => col.name) || [];
              }
              const newColumns = columnsMap[tableId] || [];

              if (existingColumns.length > 0 || newColumns.length > 0) {
                  conflicts.push({
                      tableId,
                      tableName: existingTable.name || tableId,
                      existingColumns,
                      newColumns,
                      hasExistingColumns: existingColumns.length > 0,
                      hasNewColumns: newColumns.length > 0
                  });
              }
          }
      }

      return res.json({
          hasConflicts: conflicts.length > 0,
          conflicts,
          existingIndexId: existingIndex.id
      });
  } catch (error) {
      console.error('Error checking conflicts:', error);
      res.status(500).json({ error: 'Failed to check conflicts' });
  }
});

// GET /api/rag/indexes - Get all Knowledge Bases
app.get('/api/rag/indexes', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      // Fetch user info to get name for folder lookup
      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      const indexes = await getAllRAGIndexes(req.userId, userName);
      res.json({ indexes });
  } catch (error) {
      console.error('Error fetching Knowledge Bases:', error);
      res.status(500).json({ error: 'Failed to fetch Knowledge Bases' });
  }
});

// GET /api/rag/index/:projectId - Get Knowledge Base for a project
app.get('/api/rag/index/:projectId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      // Fetch user info to get name for folder lookup
      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      const { projectId } = req.params;
      const index = await getRAGIndex(projectId, req.userId, userName);

      if (!index) {
          return res.status(404).json({ error: 'No Knowledge Base found for this project' });
      }

      res.json({ index });
  } catch (error) {
      console.error('Error getting Knowledge Base:', error);
      res.status(500).json({ error: 'Failed to get Knowledge Base' });
  }
});

// POST /api/rag/add-question - Add a question/query pair to a Knowledge Base
app.post('/api/rag/add-question', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      // Fetch user info to get name for folder lookup
      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      const { projectId, baseId, database, question, query, answer, dataSourceType } = req.body;
      
      // Determine identifier based on data source type (similar to createRAGIndex logic)
      let identifier: string | undefined;
      if (dataSourceType === 'airtable') {
          identifier = baseId;
      } else if (dataSourceType === 'bigquery') {
          identifier = projectId;
      } else if (dataSourceType === 'databricks') {
          identifier = database;
      } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
          identifier = database;
      } else if (dataSourceType === 'redshift') {
          identifier = database;
      } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
          identifier = database;
      } else if (dataSourceType === 'snowflake') {
          identifier = database;
      } else if (dataSourceType === 'mysql') {
          identifier = database;
      } else {
          identifier = database;
      }
      
      if (!identifier || !question) {
          return res.status(400).json({ 
              error: 'projectId/baseId/database and question are required' 
          });
      }
      
      // Query is optional - can be empty string for general knowledge Q&A pairs
      await addQuestionToRAGIndex(identifier, req.userId, question, query || '', answer, userName);
      res.json({ success: true, message: 'Question added successfully' });
  } catch (error: any) {
      console.error('Error adding question to Knowledge Base:', error);
      res.status(500).json({ error: error.message || 'Failed to add question' });
  }
});

// DELETE /api/rag/index/:projectId - Delete a Knowledge Base
app.delete('/api/rag/index/:projectId', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      // Fetch user info to get name for folder lookup
      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      const { projectId } = req.params;
      await deleteRAGIndex(projectId, req.userId, userName);
      res.json({ success: true, message: 'Knowledge Base deleted successfully' });
  } catch (error: any) {
      console.error('Error deleting Knowledge Base:', error);
      res.status(500).json({ error: error.message || 'Failed to delete Knowledge Base' });
  }
});

// DELETE /api/rag/tables - Delete tables from a Knowledge Base
app.delete('/api/rag/tables', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      const { projectId, baseId, database, tableIds, dataSourceType } = req.body;
      
      // Determine identifier based on data source type (similar to createRAGIndex logic)
      let identifier: string | undefined;
      if (dataSourceType === 'airtable') {
          identifier = baseId;
      } else if (dataSourceType === 'bigquery') {
          identifier = projectId;
      } else if (dataSourceType === 'databricks') {
          identifier = database;
      } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
          identifier = database;
      } else if (dataSourceType === 'redshift') {
          identifier = database;
      } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
          identifier = database;
      } else if (dataSourceType === 'snowflake') {
          identifier = database;
      } else if (dataSourceType === 'mysql') {
          identifier = database;
      } else {
          identifier = database;
      }
      
      if (!identifier || !tableIds || !Array.isArray(tableIds)) {
          return res.status(400).json({ error: 'projectId/baseId/database and tableIds array are required' });
      }

      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      await deleteTablesFromRAGIndex(identifier, req.userId, tableIds, userName);
      res.json({ success: true, message: 'Tables deleted successfully' });
  } catch (error: any) {
      console.error('Error deleting tables:', error);
      res.status(500).json({ error: error.message || 'Failed to delete tables' });
  }
});

// DELETE /api/rag/questions - Delete Q&A pairs from a Knowledge Base
app.delete('/api/rag/questions', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      const { projectId, baseId, database, questionIndices, dataSourceType } = req.body;
      
      // Determine identifier based on data source type (similar to createRAGIndex logic)
      let identifier: string | undefined;
      if (dataSourceType === 'airtable') {
          identifier = baseId;
      } else if (dataSourceType === 'bigquery') {
          identifier = projectId;
      } else if (dataSourceType === 'databricks') {
          identifier = database;
      } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
          identifier = database;
      } else if (dataSourceType === 'redshift') {
          identifier = database;
      } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
          identifier = database;
      } else if (dataSourceType === 'snowflake') {
          identifier = database;
      } else if (dataSourceType === 'mysql') {
          identifier = database;
      } else {
          identifier = database;
      }
      
      if (!identifier || !questionIndices || !Array.isArray(questionIndices)) {
          return res.status(400).json({ error: 'projectId/baseId/database and questionIndices array are required' });
      }

      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      await deleteQuestionsFromRAGIndex(identifier, req.userId, questionIndices, userName);
      res.json({ success: true, message: 'Q&A pairs deleted successfully' });
  } catch (error: any) {
      console.error('Error deleting Q&A pairs:', error);
      res.status(500).json({ error: error.message || 'Failed to delete Q&A pairs' });
  }
});

// PUT /api/rag/table - Update a table in a Knowledge Base
app.put('/api/rag/table', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      const { projectId, baseId, database, tableId, updates, dataSourceType } = req.body;
      
      // Determine identifier based on data source type (similar to createRAGIndex logic)
      let identifier: string | undefined;
      if (dataSourceType === 'airtable') {
          identifier = baseId;
      } else if (dataSourceType === 'bigquery') {
          identifier = projectId;
      } else if (dataSourceType === 'databricks') {
          identifier = database;
      } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
          identifier = database;
      } else if (dataSourceType === 'redshift') {
          identifier = database;
      } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
          identifier = database;
      } else if (dataSourceType === 'snowflake') {
          identifier = database;
      } else if (dataSourceType === 'mysql') {
          identifier = database;
      } else {
          identifier = database;
      }
      
      if (!identifier || !tableId || !updates) {
          return res.status(400).json({ error: 'projectId/baseId/database, tableId, and updates are required' });
      }

      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      await updateTableInRAGIndex(identifier, req.userId, tableId, updates, userName);
      res.json({ success: true, message: 'Table updated successfully' });
  } catch (error: any) {
      console.error('Error updating table:', error);
      res.status(500).json({ error: error.message || 'Failed to update table' });
  }
});

// PUT /api/rag/question - Update a Q&A pair in a Knowledge Base
app.put('/api/rag/question', authenticateToken, async (req: AuthenticatedRequest, res) => {
  try {
      if (!req.userId) {
          return res.status(401).json({ error: 'Authentication required' });
      }

      const { projectId, baseId, database, questionIndex, updates, dataSourceType } = req.body;
      
      // Determine identifier based on data source type (similar to createRAGIndex logic)
      let identifier: string | undefined;
      if (dataSourceType === 'airtable') {
          identifier = baseId;
      } else if (dataSourceType === 'bigquery') {
          identifier = projectId;
      } else if (dataSourceType === 'databricks') {
          identifier = database;
      } else if (dataSourceType === 'postgres' || dataSourceType === 'postgresql') {
          identifier = database;
      } else if (dataSourceType === 'redshift') {
          identifier = database;
      } else if (dataSourceType === 'azure' || dataSourceType === 'sqlserver') {
          identifier = database;
      } else if (dataSourceType === 'snowflake') {
          identifier = database;
      } else if (dataSourceType === 'mysql') {
          identifier = database;
      } else {
          identifier = database;
      }
      
      if (!identifier || questionIndex === undefined || !updates) {
          return res.status(400).json({ error: 'projectId/baseId/database, questionIndex, and updates are required' });
      }

      const user = await userService.getUserById(req.userId);
      const userName = user?.name || user?.email || null;

      await updateQuestionInRAGIndex(identifier, req.userId, questionIndex, updates, userName);
      res.json({ success: true, message: 'Q&A pair updated successfully' });
  } catch (error: any) {
      console.error('Error updating Q&A pair:', error);
      res.status(500).json({ error: error.message || 'Failed to update Q&A pair' });
  }
});

// Serve frontend for all other routes (SPA routing)
if (fs.existsSync(frontendBuildPath)) {
  app.get('*', (req, res) => {
      res.sendFile(path.join(frontendBuildPath, 'index.html'));
  });
}

// ─── 404 & error handlers (must be after all routes above) ─────────────────────
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Server Error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, async () => {
  console.log(`\n🚀 AIquery Backend running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\n   LLM Models:`);
  console.log(`     • Claude 3.7 Sonnet  (Anthropic)`);
  console.log(`     • Gemini 2.0 Flash   (Google)`);
  console.log(`     • GPT-4o Mini        (OpenAI)`);
  console.log(`\n   Data Sources (8 total):`);
  console.log(`     • MySQL, PostgreSQL, Snowflake, Databricks`);
  console.log(`     • Airtable, BigQuery, Azure SQL, Redshift`);
  console.log(`\n   REST API endpoints:`);
  console.log(`     GET    /api/health`);
  console.log(`     POST   /api/aiquery`);
  console.log(`     GET    /api/models`);
  console.log(`     GET    /api/schema`);
  console.log(`     POST   /api/execute`);
  console.log(`     POST   /api/validate`);
  console.log(`     POST   /api/rag/generate`);
  console.log(`     GET    /api/rag/list`);
  console.log(`     GET    /api/rag/file/:name`);
  console.log(`     DELETE /api/rag/file/:name`);
  console.log(`     POST   /api/summary`);
  // Slack status (Bolt vs per-user) is printed after DB init in initializeSlackServices()

  // Run migrations / CREATE TABLE before any code that queries `users`
  try {
    await initializeDatabase();
  } catch (error) {
    console.error('Failed to initialize database:', error);
    console.error('The application will continue, but database features may not work.');
  }

  // Test database connection
  const dbConnected = await testDatabaseConnection();
  if (dbConnected) {
    console.log('\n   ✅ Database connection successful');
    console.log(`   🔎 Active DB: ${getDatabaseConnectionIdentity()}`);
    await logDatabaseSanitySummary();
  } else {
    console.warn('\n   ⚠️  Database connection failed - some features may not work');
    console.warn('   Please check your DATABASE_URL or DB_* environment variables');
  }

  await initializeSlackServices();
  await logRagStartupSummary();
  console.log(`\n   📊 Data querying and visualization ready\n`);
});

export default app;
