import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { useAuth } from '../contexts/AuthContext'
import './ChatHistory.css'

interface ChatHistoryItem {
  id: number
  sessionId: string
  question: string
  createdAt: string
  updatedAt: string
}

interface ChatHistoryProps {
  onSelectSession: (sessionId: string | undefined) => void
  currentSessionId?: string
  /** Increment when a message completes so the list refreshes even if currentSessionId is unchanged */
  refreshTrigger?: number
  showNewChat?: boolean
  variant?: 'default' | 'compact'
}

const ChatHistory: React.FC<ChatHistoryProps> = ({
  onSelectSession,
  currentSessionId,
  refreshTrigger = 0,
  showNewChat = true,
  variant = 'default'
}) => {
  const { token, isAuthenticated } = useAuth()
  const [items, setItems] = useState<ChatHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedItemIds, setSelectedItemIds] = useState<Set<number>>(new Set())

  useEffect(() => {
    if (isAuthenticated) {
      loadSessions()
    } else {
      setLoading(false)
    }
  }, [isAuthenticated])

  // Refresh when session changes or after each completed reply (refreshTrigger)
  useEffect(() => {
    if (!isAuthenticated) return
    loadSessions()
    const timer = setTimeout(() => loadSessions(), 400)
    return () => clearTimeout(timer)
  }, [currentSessionId, isAuthenticated, refreshTrigger])

  const loadSessions = async () => {
    try {
      const response = await axios.get('/api/chat/history/questions?limit=200', {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (response.data.success) {
        const sortedItems = response.data.items
          .sort((a: ChatHistoryItem, b: ChatHistoryItem) =>
            new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
          )
        setItems(sortedItems)
      }
    } catch (error) {
      console.error('Error loading chat history items:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleNewChat = () => {
    // Clear current session to start fresh (pass undefined to start new session)
    onSelectSession(undefined)
  }

  const handleSessionClick = (sessionId: string) => {
    onSelectSession(sessionId)
  }

  const handleDeleteItem = async (itemId: number, itemSessionId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    
    if (!confirm('Are you sure you want to delete this question?')) {
      return
    }

    try {
      await axios.delete(`/api/chat/history/messages/${itemId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })

      if (itemSessionId === currentSessionId) {
        onSelectSession(undefined)
      }
      
      loadSessions()
    } catch (error) {
      console.error('Error deleting session:', error)
      alert('Failed to delete session')
    }
  }

  /** Compare calendar dates in local time — elapsed ms / 24h incorrectly labels "this morning" as Yesterday. */
  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    if (Number.isNaN(date.getTime())) return ''

    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const startOfItem = new Date(date.getFullYear(), date.getMonth(), date.getDate())
    const diffCalendarDays = Math.round(
      (startOfToday.getTime() - startOfItem.getTime()) / (1000 * 60 * 60 * 24)
    )

    if (diffCalendarDays === 0) return 'Today'
    if (diffCalendarDays === 1) return 'Yesterday'
    if (diffCalendarDays >= 2 && diffCalendarDays < 7) {
      return `${diffCalendarDays} days ago`
    }
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
    })
  }

  // Filter sessions based on search query
  const filteredItems = items.filter(item => {
    if (!searchQuery.trim()) return true
    const query = searchQuery.toLowerCase()
    const question = (item.question || '').toLowerCase()
    return question.includes(query)
  })

  // Handle checkbox toggle
  const toggleItemSelection = (itemId: number) => {
    setSelectedItemIds(prev => {
      const newSet = new Set(prev)
      if (newSet.has(itemId)) {
        newSet.delete(itemId)
      } else {
        newSet.add(itemId)
      }
      return newSet
    })
  }

  const handleCheckboxToggle = (itemId: number, e: React.MouseEvent) => {
    e.stopPropagation()
    toggleItemSelection(itemId)
  }

  // Handle select all/none
  const handleSelectAll = () => {
    if (selectedItemIds.size === filteredItems.length) {
      setSelectedItemIds(new Set())
    } else {
      setSelectedItemIds(new Set(filteredItems.map((x) => x.id)))
    }
  }

  // Handle bulk delete
  const handleBulkDelete = async () => {
    if (selectedItemIds.size === 0) return

    const count = selectedItemIds.size
    if (!confirm(`Are you sure you want to delete ${count} question${count > 1 ? 's' : ''}?`)) {
      return
    }

    try {
      const deletePromises = Array.from(selectedItemIds).map(itemId =>
        axios.delete(`/api/chat/history/messages/${itemId}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      )

      await Promise.all(deletePromises)
      setSelectedItemIds(new Set())
      loadSessions()
    } catch (error) {
      console.error('Error deleting messages:', error)
      alert('Failed to delete some questions')
    }
  }

  if (!isAuthenticated) {
    return null
  }

  if (loading) {
    return (
      <div className="chat-history-section">
        <div className="chat-history-loading">Loading...</div>
      </div>
    )
  }

  return (
    <div className={`chat-history-section ${variant === 'compact' ? 'compact' : ''}`}>
      {showNewChat && (
        <button
          className="chat-history-new-button"
          onClick={handleNewChat}
          title="Start new chat"
        >
          <span className="chat-history-icon">➕</span>
          <span className="chat-history-text">New Chat</span>
        </button>
      )}

      {/* Search/Filter Input */}
      <div className="chat-history-search">
        <input
          type="text"
          placeholder="🔍 Search questions..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="chat-history-search-input"
        />
      </div>

      {/* Bulk Actions Bar */}
      {selectedItemIds.size > 0 && (
        <div className="chat-history-bulk-actions">
          <span className="chat-history-selected-count">
            {selectedItemIds.size} selected
          </span>
          <button
            className="chat-history-bulk-delete-button"
            onClick={handleBulkDelete}
            title="Delete selected"
          >
            🗑️ Delete Selected
          </button>
        </div>
      )}

      {/* Select All Checkbox */}
      {filteredItems.length > 0 && (
        <div className="chat-history-select-all">
          <label className="chat-history-select-all-label">
            <input
              type="checkbox"
              checked={selectedItemIds.size === filteredItems.length && filteredItems.length > 0}
              onChange={handleSelectAll}
              onClick={(e) => e.stopPropagation()}
            />
            <span>Select All</span>
          </label>
        </div>
      )}

      <div className="chat-history-list">
        {filteredItems.length === 0 ? (
          <div className="chat-history-empty">
            <p>{searchQuery ? 'No matching questions' : 'No chat history'}</p>
            <p className="chat-history-hint">
              {searchQuery ? 'Try a different search term' : 'Start a conversation to see it here'}
            </p>
          </div>
        ) : (
          filteredItems.map((item) => (
            <div
              key={item.id}
              className={`chat-history-item ${currentSessionId === item.sessionId ? 'active' : ''}`}
              onClick={() => handleSessionClick(item.sessionId)}
            >
              <>
                  <div className="chat-history-item-checkbox" onClick={(e) => handleCheckboxToggle(item.id, e)}>
                    <input
                      type="checkbox"
                      checked={selectedItemIds.has(item.id)}
                      onChange={(e) => {
                        e.stopPropagation()
                        toggleItemSelection(item.id)
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  <div className="chat-history-item-content">
                    <div className="chat-history-item-info">
                      <span className="chat-history-item-title">
                        {item.question || 'New Chat'}
                      </span>
                      <span className="chat-history-item-meta">
                        {formatDate(item.updatedAt)}
                      </span>
                    </div>
                  </div>
                  <div className="chat-history-item-actions">
                    <button
                      className="chat-history-action-button"
                      onClick={(e) => handleDeleteItem(item.id, item.sessionId, e)}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
              </>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default ChatHistory
