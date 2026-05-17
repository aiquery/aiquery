import React, { useState, useRef, useEffect } from 'react'
import './ChatBot.css'
import axios, { type AxiosResponse } from 'axios'
import { useAuth } from '../contexts/AuthContext'
import {
  buildUploadedTabularContextFromFiles,
  isTabularFileName,
  questionReferencesUploadWithoutAttachment,
} from '../utils/uploadedTabularContext'
import { buildExecutionSteps, type ExecutionStep } from '@shared/execution-steps'

interface Message {
  type: 'user' | 'assistant'
  content: string
  timestamp: Date
  /** Saved with data-query turns; shown when reopening a session. */
  executionSteps?: ExecutionStep[]
  /** LLM-generated follow-ups for data-query turns; restored from session history. */
  followUpQuestions?: string[]
}

interface ChatResponse {
  interpretation: string
  sqlQuery?: string
  queryResults?: any[]
  executionSteps?: ExecutionStep[]
  followUpQuestions?: string[]
  visualization?: {
    success: boolean
    imagePath?: string
    chartType?: string
    error?: string
  }
}

/** POST /api/chat JSON body variants the UI accepts. */
interface ChatApiPayload extends ChatResponse {
  sessionId?: string
  imagePath?: string
  text?: string
  response?: string
}

interface ChatBotProps {
  sessionId?: string
  onSessionCreated?: (sessionId: string) => void
}

function hasDataQueryResult(r: ChatResponse | null | undefined): boolean {
  if (!r) return false
  return Boolean(
    r.sqlQuery ||
    (Array.isArray(r.queryResults) && r.queryResults.length > 0)
  )
}

function normalizeFollowUpQuestions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, 6)
}

function clampChartZoom(z: number): number {
  return Math.min(5, Math.max(0.25, z))
}

const SUGGESTED_QUESTIONS = [
  "What was the revenue each day in the last month?",
  "Show me the top 5 products by sales amount last month?",
  "How many leads for each platform did we get yesterday?",
  "List the customers who placed orders in multiple years"
]

/** Collapse very long SQL explanations in the panel until user clicks "See all" */
const SQL_EXPLANATION_PREVIEW_CHARS = 8000

/** Browser console prefix — filter DevTools by this string to see upload flow. */
const UPLOAD_LOG_PREFIX = '[ChatBot upload]'

// Helper function to format values for display (handles dates, objects, etc.)
const formatValueForDisplay = (value: any): string => {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value.toISOString().split('T')[0]
  // Format floats to 2 decimal places
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return value.toFixed(2)
  }
  if (typeof value === 'object') {
    if (value.value && typeof value.value === 'string') return value.value
    if (value.toString && value.toString !== Object.prototype.toString) {
      const str = value.toString()
      if (str !== '[object Object]') return str
    }
    if (value.date) return String(value.date)
    if (value.timestamp) return String(value.timestamp)
    if (value.time) return String(value.time)
    try { return JSON.stringify(value) } catch { return '' }
  }
  return String(value)
}

const ChatBot: React.FC<ChatBotProps> = ({ sessionId, onSessionCreated }) => {
  const { token, isAuthenticated, user } = useAuth()
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [currentResponse, setCurrentResponse] = useState<ChatResponse | null>(null)
  const [showSQL, setShowSQL] = useState(false)
  const [showChart, setShowChart] = useState(false)
  const [chartUrl, setChartUrl] = useState<string | null>(null)
  const [showChartModal, setShowChartModal] = useState(false)
  const [chartZoomInline, setChartZoomInline] = useState(1)
  const [chartModalZoom, setChartModalZoom] = useState(1)
  const [showAllData, setShowAllData] = useState(false)
  const [showCSVData, setShowCSVData] = useState(true)
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>(sessionId)
  const [explicitlySelectedSession, setExplicitlySelectedSession] = useState<string | undefined>(undefined)
  const [editableSQL, setEditableSQL] = useState('')
  const [isEditingSQL, setIsEditingSQL] = useState(false)
  const [showSQLExplanation, setShowSQLExplanation] = useState(false)
  const [sqlExplanation, setSqlExplanation] = useState('')
  const [loadingExplanation, setLoadingExplanation] = useState(false)
  const [sqlExplanationSeeAll, setSqlExplanationSeeAll] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  /** Tracks session changes so we clear uploads only when switching threads, not when sessionId is first set after Send. */
  const prevSessionForUploadRef = useRef<string | undefined>(undefined)
  const [uploadAttachment, setUploadAttachment] = useState<{
    fileNames: string[]
    /** Client-parsed tabular text (legacy path when upload-temp fails). */
    context?: string
    /** Raw files for multipart POST — used when temp upload is unavailable. */
    files?: File[]
    /** Server saved files under frontend/temp — /api/chat loads via loadUploadedContextFromTempFiles. */
    tempUploadFiles?: Array<{ storedName: string; originalName: string }>
  } | null>(null)
  /** Shown immediately on file pick (Ellie-style) — before async xlsx parse finishes. */
  const [pendingFileNames, setPendingFileNames] = useState<string[]>([])
  /** Stable display names for the selected upload; cleared only by user/session reset. */
  const [selectedUploadFileNames, setSelectedUploadFileNames] = useState<string[]>([])
  const [uploadParsing, setUploadParsing] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [isDataSectionExpanded, setIsDataSectionExpanded] = useState(true)
  const [isChartSectionExpanded, setIsChartSectionExpanded] = useState(true)
  const [isSQLSectionExpanded, setIsSQLSectionExpanded] = useState(true)
  const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
    // Load saved width from localStorage or use default (60% of container)
    const saved = localStorage.getItem('aiquery_chatbot_left_panel_width')
    return saved ? parseInt(saved, 10) : null
  })
  const [isResizing, setIsResizing] = useState(false)
  const [workSteps, setWorkSteps] = useState<ExecutionStep[]>([])
  const [activeStepIndex, setActiveStepIndex] = useState(0)
  const [workProgressPercent, setWorkProgressPercent] = useState(12)
  const [stepFeedback, setStepFeedback] = useState<'up' | 'down' | null>(null)

  // Load messages when session changes
  useEffect(() => {
    if (sessionId && isAuthenticated && typeof sessionId === 'string' && sessionId.trim() !== '') {
      const prev = prevSessionForUploadRef.current
      // User picked a *different* session in the sidebar — don't keep the previous chat's file in memory
      if (prev !== undefined && prev !== sessionId) {
        setUploadAttachment(null)
        setPendingFileNames([])
        setSelectedUploadFileNames([])
        setUploadError(null)
      }
      prevSessionForUploadRef.current = sessionId
      console.log('📂 Loading session from chat history:', sessionId)
      loadSessionMessages(sessionId)
      setCurrentSessionId(sessionId)
      setExplicitlySelectedSession(sessionId) // Mark as explicitly selected
    } else {
      prevSessionForUploadRef.current = undefined
      // No session selected - user is starting fresh
      console.log('🆕 Starting fresh - no session selected')
      setMessages([])
      setCurrentResponse(null)
      setCurrentSessionId(undefined)
      setExplicitlySelectedSession(undefined) // Critical: ensure this is undefined
      setShowSQL(false)
      setShowChart(false)
      setChartUrl(null)
      setShowAllData(false)
      setShowCSVData(true)
      setShowSQLExplanation(false)
      setSqlExplanation('')
      setSqlExplanationSeeAll(false)
      setUploadAttachment(null)
      setPendingFileNames([])
      setSelectedUploadFileNames([])
      setUploadError(null)
    }
  }, [sessionId, isAuthenticated])

  const loadSessionMessages = async (sessionIdToLoad: string) => {
    try {
      const response = await axios.get(`/api/chat/history/sessions/${sessionIdToLoad}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.data.success) {
        const loadedMessages: Message[] = []
        response.data.messages.forEach((msg: any) => {
          loadedMessages.push({
            type: 'user',
            content: msg.question,
            timestamp: new Date(msg.createdAt)
          })
          const followUps = normalizeFollowUpQuestions(msg.followUpQuestions)
          loadedMessages.push({
            type: 'assistant',
            content: msg.response,
            timestamp: new Date(msg.createdAt),
            executionSteps:
              Array.isArray(msg.executionSteps) && msg.executionSteps.length > 0
                ? msg.executionSteps
                : undefined,
            followUpQuestions: followUps.length > 0 ? followUps : undefined,
          })
        })
        setMessages(loadedMessages)
        
        if (response.data.messages.length > 0) {
          const lastMsg = response.data.messages[response.data.messages.length - 1]
          setCurrentResponse({
            interpretation: lastMsg.response,
            sqlQuery: lastMsg.sqlQuery,
            queryResults: lastMsg.queryResults,
            executionSteps:
              Array.isArray(lastMsg.executionSteps) && lastMsg.executionSteps.length > 0
                ? lastMsg.executionSteps
                : undefined,
            followUpQuestions: normalizeFollowUpQuestions(lastMsg.followUpQuestions),
          })
          if (lastMsg.sqlQuery) {
            setEditableSQL(lastMsg.sqlQuery)
          }
          setShowSQLExplanation(false)
          setSqlExplanation('')
          setSqlExplanationSeeAll(false)
        }
      }
    } catch (error) {
      console.error('Error loading session messages:', error)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!loading || workSteps.length === 0) return
    setActiveStepIndex(0)
    setWorkProgressPercent(12)
    const maxStepIndex = Math.max(0, workSteps.length - 1)
    const defaultMilestones = [12, 30, 50, 72, 88]
    const milestones =
      workSteps.length <= defaultMilestones.length
        ? defaultMilestones.slice(0, workSteps.length)
        : Array.from({ length: workSteps.length }, (_, idx) =>
            Math.min(92, 12 + Math.round((80 * idx) / Math.max(1, workSteps.length - 1)))
          )
    const timer = window.setInterval(() => {
      setWorkProgressPercent((prevPercent) => {
        const nextPercent = Math.min(92, prevPercent + 2)
        let nextStepIdx = 0
        for (let i = 0; i < milestones.length; i += 1) {
          if (nextPercent >= milestones[i]) nextStepIdx = i
        }
        setActiveStepIndex((prevIdx) => Math.max(prevIdx, Math.min(nextStepIdx, maxStepIndex)))
        return nextPercent
      })
    }, 900)
    return () => window.clearInterval(timer)
  }, [loading, workSteps.length])

  /** Debug: log whenever attachment state changes (visible in DevTools → Console). */
  useEffect(() => {
    if (pendingFileNames.length === 0 && !uploadAttachment && !uploadParsing) return
    console.log(UPLOAD_LOG_PREFIX, 'state', {
      pendingFileNames,
      uploadParsing,
      hasParsedContext: Boolean(uploadAttachment?.context?.length),
      hasTempUpload: Boolean(uploadAttachment?.tempUploadFiles?.length),
      contextCharLength: uploadAttachment?.context?.length ?? 0,
    })
  }, [pendingFileNames, uploadAttachment, uploadParsing])

  useEffect(() => {
    const handleEscKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && showChartModal) {
        setShowChartModal(false)
      }
    }

    if (showChartModal) {
      document.addEventListener('keydown', handleEscKey)
      document.body.style.overflow = 'hidden'
    }

    return () => {
      document.removeEventListener('keydown', handleEscKey)
      document.body.style.overflow = 'unset'
    }
  }, [showChartModal])

  useEffect(() => {
    setChartZoomInline(1)
  }, [chartUrl])

  useEffect(() => {
    if (showChartModal) setChartModalZoom(1)
  }, [showChartModal])

  const handleChartRequest = async (chartType: string) => {
    if (!currentResponse) return
    
    setLoading(true)
    try {
      const response = await axios.post('/api/visualize', {
        data: currentResponse.queryResults,
        action: `changeChartType-${chartType}`,
        question: messages[messages.length - 2]?.content
      })
      
      if (response.data.imagePath) {
        const imageFilename = response.data.imagePath.split(/[/\\]/).pop() || ''
        const chartUrlPath = `/api/chart/${encodeURIComponent(imageFilename)}`
        setChartUrl(chartUrlPath)
        setShowChart(true)
      }
    } catch (error) {
      console.error('Error generating chart:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleExplainSQL = async () => {
    if (!currentResponse?.sqlQuery) return
    
    setLoadingExplanation(true)
    setShowSQLExplanation(true)
    setSqlExplanationSeeAll(false)
    try {
      // Get LLM provider/model settings (use user-specific key if authenticated, otherwise generic)
      const currentUserId = localStorage.getItem('aiquery_current_user_id')
      const llmProvider = currentUserId 
        ? (localStorage.getItem(`aiquery_llm_provider_${currentUserId}`) || 'openai')
        : (localStorage.getItem('aiquery_llm_provider') || 'openai')
      let llmModelType = 'full'
      if (currentUserId) {
        if (llmProvider === 'openai') {
          llmModelType = localStorage.getItem(`aiquery_openai_model_${currentUserId}`) || 'full'
        } else if (llmProvider === 'gemini') {
          llmModelType = localStorage.getItem(`aiquery_gemini_model_${currentUserId}`) || 'full'
        } else {
          llmModelType = localStorage.getItem(`aiquery_anthropic_model_${currentUserId}`) || 'full'
        }
      } else {
        llmModelType = localStorage.getItem('aiquery_llm_model_type') || 'full'
      }
      const llmApiKey = currentUserId
        ? (llmProvider === 'openai'
            ? localStorage.getItem(`aiquery_openai_api_key_${currentUserId}`) || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem(`aiquery_gemini_api_key_${currentUserId}`) || ''
              : localStorage.getItem(`aiquery_anthropic_api_key_${currentUserId}`) || '')
        : (llmProvider === 'openai'
            ? localStorage.getItem('aiquery_openai_api_key') || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem('aiquery_gemini_api_key') || ''
              : localStorage.getItem('aiquery_anthropic_api_key') || '')
      const llmCustomModel = currentUserId
        ? (llmProvider === 'openai'
            ? localStorage.getItem(`aiquery_openai_custom_model_${currentUserId}`) || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem(`aiquery_gemini_custom_model_${currentUserId}`) || ''
              : localStorage.getItem(`aiquery_anthropic_custom_model_${currentUserId}`) || '')
        : (llmProvider === 'openai'
            ? localStorage.getItem('aiquery_openai_custom_model') || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem('aiquery_gemini_custom_model') || ''
              : localStorage.getItem('aiquery_anthropic_custom_model') || '')
      const llmModel =
        llmModelType === 'custom' && llmCustomModel.trim()
          ? llmCustomModel.trim()
          : llmProvider === 'openai'
            ? (llmModelType === 'light' ? 'gpt-4o-mini' : 'gpt-4o')
            : llmProvider === 'gemini'
              ? (llmModelType === 'light' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash')
              : (llmModelType === 'light' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6')
      const response = await axios.post('/api/explain-sql', {
        sqlQuery: currentResponse.sqlQuery,
        llmProvider: llmProvider,
        llmApiKey: llmApiKey.trim() || undefined,
        llmModel: llmModel || undefined
      }, {
        headers: isAuthenticated ? { 'Authorization': `Bearer ${token}` } : {}
      })
      
      if (response.data.explanation) {
        setSqlExplanation(response.data.explanation)
      }
    } catch (error) {
      console.error('Error explaining SQL:', error)
      setSqlExplanation('Unable to generate explanation. Please try again.')
    } finally {
      setLoadingExplanation(false)
    }
  }

  const handleSaveSQL = () => {
    if (!editableSQL.trim()) return
    
    // Update currentResponse with the edited SQL
    setCurrentResponse(prev => ({
      ...prev!,
      sqlQuery: editableSQL
    }))
    setIsEditingSQL(false)
  }

  const handleRunSQL = async () => {
    if (!editableSQL.trim()) return
    
    setLoading(true)
    try {
      console.log('Running SQL query:', editableSQL)
      
      // Send request - backend will get connection config from user's saved settings
      const response = await axios.post('/api/query/execute', {
        sqlQuery: editableSQL
      }, {
        headers: isAuthenticated ? { 'Authorization': `Bearer ${token}` } : {}
      })

      console.log('SQL execution response:', response.data)

      if (response.data.success) {
        setShowAllData(false) // Reset to show first 5 rows
        setCurrentResponse(prev => ({
          ...prev!,
          queryResults: response.data.results,
          sqlQuery: editableSQL
        }))
        // Add success message to chat
        const successMessage: Message = {
          type: 'assistant',
          content: `✅ SQL executed successfully. Returned ${response.data.rowCount || response.data.results?.length || 0} rows.`,
          timestamp: new Date()
        }
        setMessages(prev => [...prev, successMessage])
      } else {
        // Add error message to chat
        const errorMessage: Message = {
          type: 'assistant',
          content: `❌ SQL execution failed: ${response.data.error || 'Unknown error'}`,
          timestamp: new Date()
        }
        setMessages(prev => [...prev, errorMessage])
      }
    } catch (error: any) {
      console.error('Error executing SQL:', error)
      const errorContent = error?.response?.data?.error || error?.message || 'Failed to execute SQL query'
      const errorMessage: Message = {
        type: 'assistant',
        content: `❌ SQL execution failed: ${errorContent}`,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
      setIsEditingSQL(false)
    }
  }

  const convertToCSV = (data: any[]): string => {
    if (!data || data.length === 0) return ''
    
    const allKeys = new Set<string>()
    data.forEach(row => {
      Object.keys(row).forEach(key => allKeys.add(key))
    })
    const headers = Array.from(allKeys)
    
    // Use the shared formatValueForDisplay function for consistency
    const valueToString = formatValueForDisplay
    
    const csvRows = [headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',')]
    data.forEach(row => {
      const values = headers.map(header => {
        const value = row[header]
        const stringValue = valueToString(value)
        const escapedValue = stringValue.replace(/"/g, '""')
        return `"${escapedValue}"`
      })
      csvRows.push(values.join(','))
    })
    
    return csvRows.join('\n')
  }

  const handleDownloadCSV = () => {
    if (!currentResponse?.queryResults) return
    
    const csvString = convertToCSV(currentResponse.queryResults)
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `query_results_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const handleDownloadChart = () => {
    if (!chartUrl) return
    const link = document.createElement('a')
    link.href = chartUrl
    link.download = `chart_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleSuggestedQuestion = async (question: string) => {
    setInput(question)
  }

  const handleUploadClick = () => {
    console.log(UPLOAD_LOG_PREFIX, 'Upload button clicked — opening file picker')
    setUploadError(null)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const pickedFiles = Array.from(e.target.files || [])
    e.target.value = ''
    if (!pickedFiles.length) {
      console.log(UPLOAD_LOG_PREFIX, 'file input change: no files selected')
      return
    }
    const pickedNames = pickedFiles.map((f) => f.name)
    setSelectedUploadFileNames(pickedNames)

    const supported = pickedFiles.filter((f) => isTabularFileName(f.name))
    if (!supported.length) {
      console.warn(UPLOAD_LOG_PREFIX, 'rejected file(s) — need .csv, .xlsx, or .xls')
      setUploadError('Please choose a .csv, .xlsx, or .xls file.')
      return
    }

    const names = supported.map((f) => f.name)
    console.log(UPLOAD_LOG_PREFIX, 'file(s) selected', names)

    setPendingFileNames(names)
    setSelectedUploadFileNames(names)
    setUploadAttachment(null)
    setUploadParsing(true)
    setUploadError(null)

    try {
      const fd = new FormData()
      for (const f of supported.slice(0, 2)) {
        fd.append('file', f, f.name)
      }
      console.log(UPLOAD_LOG_PREFIX, 'POST /api/chat/upload-temp …')
      const uploadRes = await axios.post<{
        success?: boolean
        files?: Array<{ storedName: string; originalName: string }>
      }>('/api/chat/upload-temp', fd, {
        headers: {
          ...(isAuthenticated && token ? { Authorization: `Bearer ${token}` } : {}),
        },
        timeout: 120000,
      })
      if (
        uploadRes.data?.success &&
        Array.isArray(uploadRes.data.files) &&
        uploadRes.data.files.length > 0
      ) {
        const meta = uploadRes.data.files.map((f) => ({
          storedName: f.storedName,
          originalName: f.originalName || f.storedName,
        }))
        console.log(UPLOAD_LOG_PREFIX, 'saved on server (frontend/temp)', meta)
        setSelectedUploadFileNames(meta.map((m) => m.originalName))
        setUploadAttachment({
          fileNames: meta.map((m) => m.originalName),
          tempUploadFiles: meta,
        })
        setPendingFileNames([])
        setUploadParsing(false)
        return
      }
      throw new Error('Upload did not return file metadata')
    } catch (serverErr: unknown) {
      console.warn(UPLOAD_LOG_PREFIX, 'upload-temp failed, falling back to browser parse', serverErr)
    }

    try {
      const t0 =
        typeof globalThis !== 'undefined' && 'performance' in globalThis
          ? globalThis.performance.now()
          : Date.now()
      const context = await buildUploadedTabularContextFromFiles(supported)
      const t1 =
        typeof globalThis !== 'undefined' && 'performance' in globalThis
          ? globalThis.performance.now()
          : Date.now()
      const ms = t1 - t0
      if (!context.trim()) {
        console.warn(UPLOAD_LOG_PREFIX, 'parse finished but context is empty')
        setUploadError('Could not read tabular data from this file.')
        setPendingFileNames([])
        return
      }
      console.log(
        UPLOAD_LOG_PREFIX,
        'parse OK (browser fallback)',
        { contextCharLength: context.length, durationMs: Math.round(ms), fileNames: names }
      )
      setUploadAttachment({
        fileNames: names,
        context,
        files: supported.slice(0, 2),
      })
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to read file.'
      console.error(UPLOAD_LOG_PREFIX, 'parse error', err)
      setUploadError(msg)
      setPendingFileNames([])
    } finally {
      setUploadParsing(false)
    }
  }

  const clearUpload = () => {
    console.log(UPLOAD_LOG_PREFIX, 'user cleared attachment')
    setUploadAttachment(null)
    setPendingFileNames([])
    setSelectedUploadFileNames([])
    setUploadError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const questionText = input.trim()
    const attachment = uploadAttachment
    const hasAttachmentContext = Boolean(attachment?.context?.trim())
    const hasAttachmentData =
      hasAttachmentContext ||
      Boolean(attachment?.files?.length) ||
      Boolean(attachment?.tempUploadFiles?.length)
    const canSend =
      (questionText.length > 0 || Boolean(attachment)) && !loading && !uploadParsing
    console.log(UPLOAD_LOG_PREFIX, 'handleSubmit', {
      canSend,
      questionLen: questionText.length,
      hasAttachmentRow: Boolean(attachment),
      hasAttachmentContext,
      hasMultipartFiles: Boolean(attachment?.files?.length),
      uploadParsing,
      loading,
      pendingFileCount: pendingFileNames.length,
    })
    if (!canSend) {
      console.warn(UPLOAD_LOG_PREFIX, 'submit ignored — cannot send yet', {
        needTextOrAttachment: !(questionText.length > 0 || attachment),
        uploadParsing,
        loading,
      })
      return
    }

    if (questionReferencesUploadWithoutAttachment(questionText) && !hasAttachmentData) {
      const msg =
        'No spreadsheet is attached for this Send. Use 📎, wait for “Ready to send”, then Send. If you already used a file earlier in this chat, re-attach it — or remove phrases like “the uploaded file” if you only want to query your database.'
      setUploadError(msg)
      console.warn(UPLOAD_LOG_PREFIX, 'blocked: question references upload without attachment')
      return
    }

    const userLines: string[] = []
    if (attachment?.fileNames.length) {
      userLines.push(`📎 ${attachment.fileNames.join(', ')}`)
    }
    if (questionText) userLines.push(questionText)
    if (!userLines.length && attachment) {
      userLines.push('Analyze the uploaded spreadsheet and answer based on this file.')
    }
    const userDisplayContent = userLines.join('\n\n')

    const baseQuestion =
      questionText || (attachment ? 'Analyze the uploaded spreadsheet and answer based on this file.' : '')

    const userMessage: Message = {
      type: 'user',
      content: userDisplayContent,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setUploadError(null)
    setLoading(true)
    setStepFeedback(null)
    setWorkSteps(buildExecutionSteps(baseQuestion))
    setActiveStepIndex(0)
    setCurrentResponse(null)
    setShowSQL(false)
    setShowChart(false)
    setChartUrl(null)
    setShowAllData(false)
    setShowCSVData(true)
    setEditableSQL('')
    setIsEditingSQL(false)
    setShowSQLExplanation(false)
    setSqlExplanation('')
    setSqlExplanationSeeAll(false)

    try {
      const savedConnections = localStorage.getItem('aiquery_connections')
      let connectionConfig: any = undefined
      if (savedConnections) {
        try {
          const connections = JSON.parse(savedConnections)
          if (connections.airtable && connections.airtable.apiKey && connections.airtable.baseId) {
            connectionConfig = { airtable: connections.airtable }
          } else if (connections.bigquery && connections.bigquery.projectId && connections.bigquery.serviceAccountKey) {
            connectionConfig = { bigquery: connections.bigquery }
          }
        } catch (err) {
          console.error('Error parsing connection config:', err)
        }
      }

      // Get LLM provider/model settings (use user-specific keys if authenticated, otherwise generic)
      const currentUserId = localStorage.getItem('aiquery_current_user_id')
      const llmProvider = currentUserId 
        ? (localStorage.getItem(`aiquery_llm_provider_${currentUserId}`) || 'openai')
        : (localStorage.getItem('aiquery_llm_provider') || 'openai')
      // Get model type - check for provider-specific model, otherwise use generic
      let llmModelType = 'full'
      if (currentUserId) {
        if (llmProvider === 'openai') {
          llmModelType = localStorage.getItem(`aiquery_openai_model_${currentUserId}`) || 'full'
        } else if (llmProvider === 'gemini') {
          llmModelType = localStorage.getItem(`aiquery_gemini_model_${currentUserId}`) || 'full'
        } else {
          llmModelType = localStorage.getItem(`aiquery_anthropic_model_${currentUserId}`) || 'full'
        }
      } else {
        llmModelType = localStorage.getItem('aiquery_llm_model_type') || 'full'
      }
      const llmApiKey = currentUserId
        ? (llmProvider === 'openai'
            ? localStorage.getItem(`aiquery_openai_api_key_${currentUserId}`) || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem(`aiquery_gemini_api_key_${currentUserId}`) || ''
              : localStorage.getItem(`aiquery_anthropic_api_key_${currentUserId}`) || '')
        : (llmProvider === 'openai'
            ? localStorage.getItem('aiquery_openai_api_key') || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem('aiquery_gemini_api_key') || ''
              : localStorage.getItem('aiquery_anthropic_api_key') || '')
      const llmCustomModel = currentUserId
        ? (llmProvider === 'openai'
            ? localStorage.getItem(`aiquery_openai_custom_model_${currentUserId}`) || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem(`aiquery_gemini_custom_model_${currentUserId}`) || ''
              : localStorage.getItem(`aiquery_anthropic_custom_model_${currentUserId}`) || '')
        : (llmProvider === 'openai'
            ? localStorage.getItem('aiquery_openai_custom_model') || ''
            : llmProvider === 'gemini'
              ? localStorage.getItem('aiquery_gemini_custom_model') || ''
              : localStorage.getItem('aiquery_anthropic_custom_model') || '')
      const llmModel =
        llmModelType === 'custom' && llmCustomModel.trim()
          ? llmCustomModel.trim()
          : llmProvider === 'openai'
            ? (llmModelType === 'light' ? 'gpt-4o-mini' : 'gpt-4o')
            : llmProvider === 'gemini'
              ? (llmModelType === 'light' ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash')
              : (llmModelType === 'light' ? 'claude-haiku-4-5-20251001' : 'claude-sonnet-4-6')

      /** Prefer server temp files; else multipart `file` fields; else JSON context. */
      const useMultipart =
        Boolean(attachment?.files?.length) && !attachment?.tempUploadFiles?.length

      let response: AxiosResponse<ChatApiPayload>

      if (useMultipart) {
        const fd = new FormData()
        fd.append('question', baseQuestion)
        fd.append('userName', 'User')
        if (connectionConfig) {
          fd.append('connectionConfig', JSON.stringify(connectionConfig))
        }
        fd.append('llmProvider', llmProvider)
        fd.append('useLightModel', llmModelType === 'light' ? 'true' : 'false')
        if (llmApiKey.trim()) fd.append('llmApiKey', llmApiKey.trim())
        if (llmModel) fd.append('llmModel', llmModel)
        if (sessionId && typeof sessionId === 'string' && sessionId.trim() !== '') {
          fd.append('sessionId', sessionId)
          console.log('📝 Sending query with existing session (multipart):', sessionId)
        } else {
          console.log('🆕 Starting new query — multipart, backend will create session if needed')
        }
        for (const f of attachment!.files!) {
          fd.append('file', f, f.name)
        }
        console.log(UPLOAD_LOG_PREFIX, 'POST /api/chat multipart', {
          fileCount: attachment!.files!.length,
          questionLength: baseQuestion.length,
        })
        console.log(UPLOAD_LOG_PREFIX, 'calling axios.post /api/chat (multipart) …')
        response = await axios.post<ChatApiPayload>('/api/chat', fd, {
          headers: {
            ...(isAuthenticated && token ? { Authorization: `Bearer ${token}` } : {}),
          },
          timeout: 180000,
        })
      } else {
        const requestBody: Record<string, unknown> = {
          question: baseQuestion,
          userName: 'User',
          connectionConfig: connectionConfig,
          llmProvider: llmProvider,
          useLightModel: llmModelType === 'light',
          llmApiKey: llmApiKey.trim() || undefined,
          llmModel: llmModel || undefined,
        }
        if (attachment?.tempUploadFiles?.length) {
          requestBody.tempUploadFiles = attachment.tempUploadFiles
        }
        if (attachment?.context?.trim()) {
          requestBody.uploadedTabularContext = attachment.context
        }

        console.log(UPLOAD_LOG_PREFIX, 'POST /api/chat JSON payload', {
          questionLength: String(requestBody.question ?? '').length,
          hasTempUploadFiles: Boolean(requestBody.tempUploadFiles),
          hasUploadedTabularContext: Boolean(requestBody.uploadedTabularContext),
          uploadedTabularContextChars: requestBody.uploadedTabularContext
            ? String(requestBody.uploadedTabularContext).length
            : 0,
        })

        if (sessionId && typeof sessionId === 'string' && sessionId.trim() !== '') {
          requestBody.sessionId = sessionId
          console.log('📝 Sending query with existing session (user selected from history):', sessionId)
        } else {
          console.log('🆕 Starting new query - no sessionId in request (backend will create new session)')
        }

        console.log(UPLOAD_LOG_PREFIX, 'calling axios.post /api/chat (JSON) …')
        response = await axios.post<ChatApiPayload>('/api/chat', requestBody, {
          headers: isAuthenticated ? { Authorization: `Bearer ${token}` } : {},
          timeout: 180000,
        })
      }
      console.log(UPLOAD_LOG_PREFIX, 'axios /api/chat OK', { status: response.status })

      const insight =
        (response.data.interpretation || response.data.text || response.data.response || '').trim() ||
        'Response received'
      const payload = response.data
      const dataAnswer = hasDataQueryResult(payload)
      const execStepsForMessage: ExecutionStep[] | undefined = dataAnswer
        ? payload.executionSteps?.length
          ? payload.executionSteps
          : buildExecutionSteps(baseQuestion)
        : undefined
      const followUpsNorm = normalizeFollowUpQuestions(payload.followUpQuestions)
      const followUpsForMessage =
        dataAnswer && followUpsNorm.length > 0 ? followUpsNorm : undefined
      const assistantMessage: Message = {
        type: 'assistant',
        content: insight,
        timestamp: new Date(),
        executionSteps: execStepsForMessage,
        followUpQuestions: followUpsForMessage,
      }

      setMessages(prev => [...prev, assistantMessage])
      setCurrentResponse({
        ...payload,
        executionSteps: execStepsForMessage ?? payload.executionSteps,
        followUpQuestions: followUpsNorm,
      })
      setActiveStepIndex((prev) => Math.max(prev, Math.max(0, (execStepsForMessage?.length ?? workSteps.length) - 1)))
      setWorkProgressPercent(100)
      
      if (response.data.sqlQuery) {
        setEditableSQL(response.data.sqlQuery)
      }
      
      // Sync session with parent + sidebar: persist backend session so follow-up turns use the
      // same session and Chat History can refresh without a full page reload.
      if (response.data.sessionId && isAuthenticated) {
        const sid = response.data.sessionId as string
        console.log('✅ Session from backend:', sid)
        setCurrentSessionId(sid)
        setExplicitlySelectedSession(sid)
        if (onSessionCreated) {
          onSessionCreated(sid)
        }
      }
      
      if (response.data.imagePath) {
        const imageFilename = response.data.imagePath.split(/[/\\]/).pop() || ''
        const chartUrlPath = `/api/chart/${encodeURIComponent(imageFilename)}`
        setChartUrl(chartUrlPath)
      }

      // Keep attachment after Send so follow-ups (“based on the uploaded file”) still send tabular context.
      // User clears with ✕; picking a new file replaces. Switching chat sessions clears (see session useEffect).

    } catch (error: any) {
      console.error(
        UPLOAD_LOG_PREFIX,
        'POST /api/chat failed',
        error?.code,
        error?.response?.status,
        error?.message
      )
      console.error('Error:', error)
      let errorContent = 'Sorry, there was an error processing your request.'
      
      if (error?.code === 'ECONNABORTED' || error?.message?.includes('timeout')) {
        errorContent =
          'Request timed out (the server may still be working on a large file or slow LLM). Try a smaller file, fewer rows in the sample, or try again.'
      } else if (error?.response?.status === 413) {
        errorContent =
          'Request body too large for the server. Try a smaller CSV/Excel file or fewer rows.'
      } else if (error?.response?.data) {
        const errorData = error.response.data
        if (errorData.message) errorContent = errorData.message
        else if (errorData.error) errorContent = errorData.error
        if (errorData.suggestion) errorContent += `\n\n💡 ${errorData.suggestion}`
      } else if (error?.message) {
        errorContent = error.message
      }
      
      const errorMessage: Message = {
        type: 'assistant',
        content: errorContent,
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setLoading(false)
    }
  }

  const applyFeedback = (type: 'up' | 'down') => {
    setStepFeedback(type)
    if (type === 'down') {
      setInput('Please improve this answer. Ask me one clarifying question first, then provide a revised result.')
    }
  }

  // Handle panel resize
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      
      const container = document.querySelector('.chatbot-main-layout')
      if (!container) return
      
      const containerRect = container.getBoundingClientRect()
      const mouseX = e.clientX - containerRect.left
      const containerWidth = containerRect.width
      
      // Calculate percentage (min 30%, max 80% of container width)
      const minPercent = 30
      const maxPercent = 80
      const percent = (mouseX / containerWidth) * 100
      
      if (percent >= minPercent && percent <= maxPercent) {
        setLeftPanelWidth(Math.round(percent))
        localStorage.setItem('aiquery_chatbot_left_panel_width', Math.round(percent).toString())
      }
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing])

  const handleResizeStart = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsResizing(true)
  }

  const userInitial = (user?.name?.trim()?.[0] || user?.email?.trim()?.[0] || 'U').toUpperCase()

  const uploadStripVisible =
    selectedUploadFileNames.length > 0 || pendingFileNames.length > 0 || Boolean(uploadAttachment)
  const attachmentDisplayNames =
    selectedUploadFileNames.length > 0
      ? selectedUploadFileNames.join(', ')
      : pendingFileNames.length > 0
      ? pendingFileNames.join(', ')
      : uploadAttachment?.fileNames?.length
        ? uploadAttachment.fileNames.join(', ')
        : uploadAttachment?.tempUploadFiles?.map((f) => f.originalName)?.join(', ') || ''
  const attachmentReady =
    Boolean(uploadAttachment?.context?.trim()) ||
    Boolean(uploadAttachment?.tempUploadFiles?.length)

  return (
    <div className="chatbot-container">
      <div className={`chatbot-main-layout ${isResizing ? 'resizing' : ''}`}>
        {/* Left side: Messages and Input */}
        <div 
          className="chatbot-left-panel"
          style={leftPanelWidth ? { width: `${leftPanelWidth}%` } : {}}
        >
          {/* Chatbot Response Box */}
          <div className="chatbot-messages">
            {messages.length === 0 && (
              <div className="welcome-message">
                <p>👋 Welcome to AIquery!</p>
                <p>Ask me anything about your data, for example:</p>
                <div className="suggested-questions-grid">
                  {SUGGESTED_QUESTIONS.map((sq, idx) => (
                    <button
                      key={idx}
                      className="suggested-question-btn"
                      onClick={() => handleSuggestedQuestion(sq)}
                    >
                      {sq}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, idx) => (
              msg.type === 'user' ? (
                <div key={idx} className="message user">
                  <div className="message-user-row">
                    <div className="message-user-bubble">{msg.content}</div>
                    <div className="message-user-avatar">{userInitial}</div>
                  </div>
                  <div className="message-user-time">{msg.timestamp.toLocaleString()}</div>
                </div>
              ) : (
                <div key={idx} className="message assistant">
                  <div className="message-assistant-row">
                    <div className="message-assistant-avatar">K</div>
                    <div className="message-assistant-content">
                      <div className="message-assistant-bubble">{msg.content}</div>
                      {msg.executionSteps && msg.executionSteps.length > 0 && (
                        <details className="execution-history">
                          <summary className="execution-history-summary">
                            How this answer was produced
                          </summary>
                          <div className="work-steps work-steps-history">
                            {msg.executionSteps.map((step) => (
                              <div key={step.id} className="work-step done">
                                <span className="work-step-dot">✓</span>
                                <div className="work-step-content">
                                  <div className="work-step-title">{step.title}</div>
                                  <div className="work-step-detail work-step-detail-done">{step.detail}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </details>
                      )}
                    </div>
                  </div>
                  <div className="message-assistant-time">{msg.timestamp.toLocaleString()}</div>
                </div>
              )
            ))}

            {loading && (
              <div className="message assistant">
                <div className="message-assistant-row">
                  <div className="message-assistant-avatar">K</div>
                  <div className="message-assistant-bubble working-bubble">
                    <div className="loading-indicator">
                      <div className="spinner"></div>
                      <span>Kira is working on your request</span>
                    </div>
                    <div className="work-progress">
                      <div className="work-progress-label">
                        <span>Progress</span>
                        <span>{workProgressPercent}%</span>
                      </div>
                      <div className="work-progress-track">
                        <div
                          className="work-progress-fill"
                          style={{ width: `${Math.max(0, Math.min(100, workProgressPercent))}%` }}
                        />
                      </div>
                    </div>
                    <div className="work-steps">
                      {workSteps.slice(0, activeStepIndex + 1).map((step, idx) => (
                        <div
                          key={step.id}
                          className={`work-step ${idx < activeStepIndex ? 'done' : 'active'}`}
                        >
                          <span className="work-step-dot">{idx < activeStepIndex ? '✓' : '…'}</span>
                          <div className="work-step-content">
                            <div className="work-step-title">{step.title}</div>
                            <div
                              className={`work-step-detail ${idx < activeStepIndex ? 'work-step-detail-done' : ''}`}
                            >
                              {step.detail}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {!loading && currentResponse?.interpretation && hasDataQueryResult(currentResponse) && (
              <div className="message assistant">
                <div className="message-assistant-row">
                  <div className="message-assistant-avatar">K</div>
                  <div className="message-assistant-bubble followup-bubble">
                    {(currentResponse.followUpQuestions?.length ?? 0) > 0 && (
                      <>
                        <div className="followup-title">Want to refine this result?</div>
                        <div className="followup-actions">
                          {(currentResponse.followUpQuestions ?? []).map((q, idx) => (
                            <button key={idx} className="followup-btn" onClick={() => setInput(q)}>
                              {q}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    <div className="feedback-actions">
                      <button
                        className={`feedback-btn ${stepFeedback === 'up' ? 'selected' : ''}`}
                        onClick={() => applyFeedback('up')}
                      >
                        👍 Helpful
                      </button>
                      <button
                        className={`feedback-btn ${stepFeedback === 'down' ? 'selected' : ''}`}
                        onClick={() => applyFeedback('down')}
                      >
                        👎 Needs improvement
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input area — Ellie-style: white bar, pending file row above attach/input/send */}
          <div className="chatbot-input-area">
            <form onSubmit={handleSubmit} className="chatbot-input-area-form">
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx,.xls,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                multiple
                className="chatbot-file-input-hidden"
                onChange={handleFileChange}
                disabled={loading}
                aria-label="Attach CSV or Excel file"
              />
              {uploadError && (
                <div className="chatbot-upload-error chatbot-upload-error-inline" role="alert">
                  {uploadError}
                </div>
              )}
              {uploadStripVisible && (
                <div
                  className="chatbot-pending-file chatbot-pending-file-above-input"
                  role="region"
                  aria-label="Uploaded data file"
                  data-testid="chatbot-upload-summary"
                >
                  <span
                    className="chatbot-pending-file-name"
                    title={attachmentDisplayNames || 'Attached file'}
                  >
                    📎 {attachmentDisplayNames || 'Attached file'}
                  </span>
                  <span className="chatbot-pending-file-status-wrap">
                    {uploadParsing && (
                      <span className="chatbot-pending-status chatbot-pending-status-parsing">
                        <span className="chatbot-pending-spinner" aria-hidden />
                        Reading file…
                      </span>
                    )}
                    {!uploadParsing && attachmentReady && (
                      <span className="chatbot-pending-status chatbot-pending-status-ready">
                        Ready to send
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="chatbot-pending-file-clear"
                    onClick={clearUpload}
                    disabled={loading || uploadParsing}
                    aria-label="Remove attachment"
                    title="Remove attachment"
                  >
                    ✕
                  </button>
                </div>
              )}
              <div className="chatbot-input-container">
                <button
                  type="button"
                  className="chatbot-attach-btn"
                  onClick={handleUploadClick}
                  disabled={loading || uploadParsing}
                  title="Attach .csv, .xlsx, or .xls"
                  aria-label="Attach spreadsheet"
                >
                  📎
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={
                    uploadAttachment?.context || uploadAttachment?.tempUploadFiles?.length
                      ? 'Ask a question about this file (or send to analyze it)…'
                      : 'Ask a question about your data…'
                  }
                  disabled={loading}
                  className="chatbot-input chatbot-input-ellie"
                />
                <button
                  type="submit"
                  disabled={
                    loading ||
                    uploadParsing ||
                    (pendingFileNames.length > 0 &&
                      !uploadAttachment?.context?.trim() &&
                      !uploadAttachment?.tempUploadFiles?.length) ||
                    (!input.trim() &&
                      !uploadAttachment?.context?.trim() &&
                      !uploadAttachment?.tempUploadFiles?.length)
                  }
                  title={
                    loading
                      ? 'Sending…'
                      : uploadParsing
                        ? 'Wait until the file finishes reading'
                        : pendingFileNames.length > 0 &&
                            !uploadAttachment?.context?.trim() &&
                            !uploadAttachment?.tempUploadFiles?.length
                          ? 'Wait until the file shows Ready'
                          : !input.trim() &&
                              !uploadAttachment?.context?.trim() &&
                              !uploadAttachment?.tempUploadFiles?.length
                            ? 'Type a question or attach a file, then click Send'
                            : 'Send message (the server runs when you click Send, not on file pick alone)'
                  }
                  className="send-button chatbot-send-ellie"
                >
                  <span className="button-icon">➤</span> Send
                </button>
              </div>
              <p className="chatbot-upload-send-hint" role="note">
                The file is saved on the app server (or read in your browser if that fails) and shown above the field —
                click <strong>Send</strong> to analyze. It stays attached for follow-ups until you remove it (✕) or
                switch chats.
              </p>
            </form>
          </div>
          <div className="chatbot-disclaimer">
            AIquery may make mistakes. Please check important information before you use it.
          </div>
        </div>

        {/* Resize handle */}
        <div 
          className="chatbot-resize-handle"
          onMouseDown={handleResizeStart}
          title="Drag to resize chatbot width"
        />

        {/* Right side: Sections (Data, Chart, SQL) */}
        <div 
          className="chatbot-right-panel"
          style={leftPanelWidth ? { width: `${100 - leftPanelWidth}%` } : {}}
        >
          {/* CSV Data Section */}
      {currentResponse?.queryResults && (
        <div className="section-box csv-section">
          <div 
            className="section-toolbar clickable-header"
            onClick={() => setIsDataSectionExpanded(!isDataSectionExpanded)}
          >
            <div className="section-title-wrapper">
              <span className="section-expand-arrow" title={isDataSectionExpanded ? 'Collapse' : 'Expand'}>{isDataSectionExpanded ? '▼' : '▶'}</span>
              <span className="section-title-text">
                Data ({currentResponse.queryResults.length} rows)
              </span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
              <button 
                className={`toolbar-btn ${showCSVData ? 'active' : ''}`}
                onClick={() => setShowCSVData(!showCSVData)}
                title={showCSVData ? 'Hide CSV Data' : 'Show CSV Data'}
              >
                {showCSVData ? (
                  <span className="btn-icon">🙈</span>
                ) : (
                  <img src="/images/showcsv.png" alt="" className="btn-icon-img" />
                )}
                {showCSVData ? 'Hide CSV Data' : 'Show CSV Data'}
              </button>
              <button className="download-btn" onClick={handleDownloadCSV} title="Download CSV">
                <span className="btn-icon">📥</span> Download CSV
              </button>
            </div>
          </div>
          {isDataSectionExpanded && showCSVData && (
          <div className="csv-data-box">
            <div className="data-table-container">
              <table className="data-table">
                <thead>
                  <tr>
                    {Object.keys(currentResponse.queryResults[0] || {}).map((header, idx) => (
                      <th key={idx}>{header.replace(/_/g, ' ')}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(showAllData ? currentResponse.queryResults : currentResponse.queryResults.slice(0, 5)).map((row, rowIdx) => (
                    <tr key={rowIdx}>
                      {Object.values(row).map((value: any, colIdx) => (
                        <td key={colIdx}>
                          {formatValueForDisplay(value)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {currentResponse.queryResults.length > 5 && (
              <div className="data-controls">
                <button
                  className="show-more-btn"
                  onClick={() => setShowAllData(!showAllData)}
                  title={showAllData ? 'Show First 5 Rows' : `Show All Data (${currentResponse.queryResults.length} rows)`}
                >
                  {showAllData ? 'Show First 5 Rows' : `Show All Data (${currentResponse.queryResults.length} rows)`}
                </button>
              </div>
            )}
          </div>
          )}
        </div>
      )}

      {/* Chart Section */}
      {currentResponse?.queryResults && (
        <div className="section-box chart-section">
          <div 
            className="section-toolbar clickable-header"
            onClick={() => setIsChartSectionExpanded(!isChartSectionExpanded)}
          >
            <div className="section-title-wrapper">
              <span className="section-expand-arrow" title={isChartSectionExpanded ? 'Collapse' : 'Expand'}>{isChartSectionExpanded ? '▼' : '▶'}</span>
              <span className="section-title-text">Chart</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
              <button
                className={`toolbar-btn ${showChart ? 'active' : ''}`}
                onClick={() => {
                  if (chartUrl) {
                    setShowChart(!showChart)
                  } else {
                    handleChartRequest('bar')
                  }
                }}
                title={showChart ? 'Hide Chart' : 'Plot Chart'}
              >
                {showChart ? (
                  <span className="btn-icon">🙈</span>
                ) : (
                  <img src="/images/plotchart1.jpg" alt="" className="btn-icon-img" />
                )}
                {showChart ? 'Hide Chart' : 'Plot Chart'}
              </button>
            <div className="chart-type-buttons">
              <button className="chart-type-btn" onClick={() => handleChartRequest('line')} title="Line">
                <img src="/images/1-line.png" alt="" className="btn-icon-img" />
                Line
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('bar')} title="Bar">
                <img src="/images/2-bar.png" alt="" className="btn-icon-img" />
                Bar
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('grouped_bar')} title="Grouped Bar">
                <img src="/images/3-grouped bar.png" alt="" className="btn-icon-img" />
                Grouped Bar
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('histogram')} title="Histogram">
                <img src="/images/4-Histogram.png" alt="" className="btn-icon-img" />
                Histogram
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('pie')} title="Pie">
                <img src="/images/5-pie.png" alt="" className="btn-icon-img" />
                Pie
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('scatter')} title="Scatter">
                <img src="/images/6-scatter.png" alt="" className="btn-icon-img" />
                Scatter
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('box_plot')} title="Box Plot">
                <img src="/images/7-box plot.png" alt="" className="btn-icon-img" />
                Box Plot
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('bubble')} title="Bubble">
                <img src="/images/8-bubble.png" alt="" className="btn-icon-img" />
                Bubble
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('kpi')} title="KPI">
                <img src="/images/9-KPI.png" alt="" className="btn-icon-img" />
                KPI
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('kpi_plus')} title="KPI Plus">
                <img src="/images/10-KPI plus.png" alt="" className="btn-icon-img" />
                KPI Plus
              </button>
              <button className="chart-type-btn" onClick={() => handleChartRequest('area')} title="Area">
                <img src="/images/11-area.png" alt="" className="btn-icon-img" />
                Area
              </button>
            </div>
            </div>
          </div>

          {isChartSectionExpanded && showChart && chartUrl && (
            <div className="chart-box">
              <div className="chart-header">
                <div className="chart-zoom-toolbar" role="toolbar" aria-label="Chart zoom">
                  <button
                    type="button"
                    className="chart-zoom-btn"
                    onClick={() => setChartZoomInline((z) => clampChartZoom(z - 0.25))}
                    title="Zoom out"
                  >
                    −
                  </button>
                  <span className="chart-zoom-label">{Math.round(chartZoomInline * 100)}%</span>
                  <button
                    type="button"
                    className="chart-zoom-btn"
                    onClick={() => setChartZoomInline((z) => clampChartZoom(z + 0.25))}
                    title="Zoom in"
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="chart-zoom-btn chart-zoom-reset"
                    onClick={() => setChartZoomInline(1)}
                    title="Reset zoom"
                  >
                    Fit
                  </button>
                  <span className="chart-zoom-hint">Ctrl+scroll</span>
                </div>
                <button className="download-btn" onClick={handleDownloadChart} title="Download Chart">
                  <span className="btn-icon">📥</span> Download Chart
                </button>
              </div>
              <div className="chart-container">
                <div
                  className="chart-scroll-area"
                  onWheel={(e) => {
                    if (!e.ctrlKey && !e.metaKey) return
                    e.preventDefault()
                    setChartZoomInline((z) => clampChartZoom(z - Math.sign(e.deltaY) * 0.12))
                  }}
                >
                  <div
                    className="chart-zoom-inner"
                    style={{
                      transform: `scale(${chartZoomInline})`,
                      transformOrigin: 'top center',
                    }}
                  >
                    <img
                      src={chartUrl}
                      alt="Data visualization"
                      onClick={() => setShowChartModal(true)}
                      style={{ cursor: 'pointer' }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* SQL Query Section */}
      {currentResponse?.sqlQuery && (
        <div className="section-box sql-section">
          <div 
            className="section-toolbar clickable-header"
            onClick={() => setIsSQLSectionExpanded(!isSQLSectionExpanded)}
          >
            <div className="section-title-wrapper">
              <span className="section-expand-arrow" title={isSQLSectionExpanded ? 'Collapse' : 'Expand'}>{isSQLSectionExpanded ? '▼' : '▶'}</span>
              <span className="section-title-text">Query</span>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
              <button
                className={`toolbar-btn ${showSQL ? 'active' : ''}`}
                onClick={() => setShowSQL(!showSQL)}
                title={showSQL ? 'Hide SQL' : 'Show SQL'}
              >
                <span className="btn-icon">{showSQL ? '🙈' : '🐵'}</span>
                {showSQL ? 'Hide SQL' : 'Show SQL'}
              </button>
            <button
              className={`toolbar-btn ${showSQLExplanation ? 'active' : ''}`}
              onClick={handleExplainSQL}
              disabled={loadingExplanation}
              title={loadingExplanation ? 'Explaining...' : 'Explain SQL'}
            >
              <span className="btn-icon">👩‍🏫</span>
              {loadingExplanation ? 'Explaining...' : 'Explain SQL'}
            </button>
            <button
              className={`toolbar-btn ${isEditingSQL ? 'active' : ''}`}
              onClick={() => {
                setIsEditingSQL(!isEditingSQL)
                setShowSQL(true)
              }}
              title="Edit SQL"
            >
              <span className="btn-icon">✏️</span>
              Edit SQL
            </button>
            {isEditingSQL && (
              <button
                className="toolbar-btn save-btn"
                onClick={handleSaveSQL}
                disabled={loading || !editableSQL.trim()}
                title="Save SQL"
              >
                <span className="btn-icon">💾</span>
                Save SQL
              </button>
            )}
            <button
              className="toolbar-btn run-btn"
              onClick={handleRunSQL}
              disabled={loading || !editableSQL.trim()}
              title="Run SQL"
            >
              <span className="btn-icon">▶️</span>
              Run SQL
            </button>
            </div>
          </div>
          
          {isSQLSectionExpanded && showSQL && (
            <div className="sql-query-box">
              {isEditingSQL ? (
                <textarea
                  className="sql-editor"
                  value={editableSQL}
                  onChange={(e) => setEditableSQL(e.target.value)}
                  rows={6}
                />
              ) : (
                <pre className="sql-query">{editableSQL || currentResponse.sqlQuery}</pre>
              )}
            </div>
          )}

          {/* SQL Explanation Box */}
          {showSQLExplanation && (
            <div className="sql-explanation-box">
              <div className="explanation-header">
                <span className="explanation-title">💡 SQL Explanation</span>
                <button 
                  className="close-explanation-btn"
                  onClick={() => setShowSQLExplanation(false)}
                  title="Close explanation"
                >
                  ✕
                </button>
              </div>
              <div className="explanation-content">
                {loadingExplanation ? (
                  <div className="loading-indicator">
                    <div className="spinner"></div>
                    <span>Generating explanation...</span>
                  </div>
                ) : (
                  <>
                    <p className="explanation-body-text">
                      {sqlExplanationSeeAll ||
                      sqlExplanation.length <= SQL_EXPLANATION_PREVIEW_CHARS
                        ? sqlExplanation
                        : `${sqlExplanation.slice(0, SQL_EXPLANATION_PREVIEW_CHARS).trimEnd()}\n\n…`}
                    </p>
                    {sqlExplanation.length > SQL_EXPLANATION_PREVIEW_CHARS && (
                      <button
                        type="button"
                        className="explanation-see-all-btn"
                        onClick={() => setSqlExplanationSeeAll((v) => !v)}
                      >
                        {sqlExplanationSeeAll ? 'Show less' : 'See all'}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}
        </div>
      </div>

      {/* Chart Modal for Zoom */}
      {showChartModal && chartUrl && (
        <div 
          className="chart-modal-overlay"
          onClick={() => setShowChartModal(false)}
        >
          <div className="chart-modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="chart-modal-header">
              <span>Chart View</span>
              <button
                className="chart-modal-close"
                onClick={() => setShowChartModal(false)}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div
              className="chart-modal-image-container"
              onWheel={(e) => {
                if (!e.ctrlKey && !e.metaKey) return
                e.preventDefault()
                setChartModalZoom((z) => clampChartZoom(z - Math.sign(e.deltaY) * 0.12))
              }}
            >
              <div
                className="chart-modal-zoom-inner"
                style={{
                  transform: `scale(${chartModalZoom})`,
                  transformOrigin: 'center center',
                }}
              >
                <img src={chartUrl} alt="Data visualization - Full Size" className="chart-modal-image" />
              </div>
            </div>
            <div className="chart-modal-footer">
              <div className="chart-modal-zoom-bar" role="toolbar" aria-label="Chart zoom">
                <button
                  type="button"
                  className="chart-zoom-btn"
                  onClick={() => setChartModalZoom((z) => clampChartZoom(z - 0.25))}
                  title="Zoom out"
                >
                  −
                </button>
                <span className="chart-zoom-label">{Math.round(chartModalZoom * 100)}%</span>
                <button
                  type="button"
                  className="chart-zoom-btn"
                  onClick={() => setChartModalZoom((z) => clampChartZoom(z + 0.25))}
                  title="Zoom in"
                >
                  +
                </button>
                <button
                  type="button"
                  className="chart-zoom-btn chart-zoom-reset"
                  onClick={() => setChartModalZoom(1)}
                  title="Reset zoom"
                >
                  Reset
                </button>
                <span className="chart-zoom-hint">Ctrl+scroll to zoom</span>
              </div>
              <button className="chart-modal-download" onClick={handleDownloadChart}>
                📥 Download Chart
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default ChatBot
