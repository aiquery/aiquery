import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import Logo from './Logo'
import './AdminDashboard.css'

type TabId = 'users' | 'support' | 'contact' | 'demo' | 'plans' | 'usage' | 'payments'

interface UserRow {
  id: number
  email: string
  name: string | null
  role: string | null
  phone_number: string | null
  email_verified: boolean | null
  status: string | null
  created_at: string
  updated_at: string
}

interface MessageRow {
  id: number
  email: string
  name?: string | null
  subject?: string | null
  message?: string
  status: string
  created_at: string
  user_email?: string
}

interface DemoRow {
  id: number
  email: string
  first_name?: string | null
  last_name?: string | null
  company_name?: string | null
  status: string
  created_at: string
}

interface UserWithPlanRow {
  id: number
  email: string
  name: string | null
  planName: string
  planType: string
  subscriptionStatus: string | null
  currentPeriodEnd: string | null
  extraUsers: number
  customLimits: {
    maxUsers: number
    maxWorkspaces: number
    maxQueriesPerMonth: number
    maxTablesPerDataSource: number
  } | null
}

interface UsageRow {
  id: number
  email: string
  name: string | null
  planName: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  totalQueries: number
  periodQueries: number
  workspaceCount: number
  memberCount: number
  connectionsCount: number
}

interface PaymentRow {
  id: number
  userId: number
  email: string
  name: string | null
  amount: number
  currency: string
  status: string
  planName: string
  planType: string
  itemType: string
  billingPeriodStart: string | null
  billingPeriodEnd: string | null
  createdAt: string
}

type PaymentsSortKey = 'id' | 'name' | 'email' | 'amount' | 'currency' | 'status' | 'planName' | 'itemType' | 'createdAt'

const STATUS_OPTIONS = ['new', 'read', 'replied'] as const
const PLAN_NAMES = ['free', 'startpro', 'smartpro', 'enterprise'] as const

// Plan default limits (must match backend subscription-service.ts getPlanLimits)
const PLAN_DEFAULT_LIMITS: Record<string, { maxUsers: number; maxWorkspaces: number; maxQueriesPerMonth: number; maxTablesPerDataSource: number }> = {
  free: { maxUsers: 1, maxWorkspaces: 1, maxQueriesPerMonth: 200, maxTablesPerDataSource: 2 },
  startpro: { maxUsers: 3, maxWorkspaces: 3, maxQueriesPerMonth: 300, maxTablesPerDataSource: 5 },
  smartpro: { maxUsers: 6, maxWorkspaces: 6, maxQueriesPerMonth: 800, maxTablesPerDataSource: 10 },
  enterprise: { maxUsers: -1, maxWorkspaces: -1, maxQueriesPerMonth: -1, maxTablesPerDataSource: -1 },
}

function formatLimits(limits: { maxUsers: number; maxWorkspaces: number; maxQueriesPerMonth: number; maxTablesPerDataSource: number }): string {
  const u = limits.maxUsers === -1 ? '∞' : limits.maxUsers
  const w = limits.maxWorkspaces === -1 ? '∞' : limits.maxWorkspaces
  const q = limits.maxQueriesPerMonth === -1 ? '∞' : limits.maxQueriesPerMonth
  const t = limits.maxTablesPerDataSource === -1 ? '∞' : limits.maxTablesPerDataSource
  return `Users: ${u}, Workspaces: ${w}, Queries: ${q}, Tables: ${t}`
}

function statusDisplayLabel(status: string): string {
  const s = (status || 'new').toLowerCase()
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function ActionsCell({
  status,
  onMarkRead,
  onMarkReplied,
}: {
  status: string
  onMarkRead: () => void
  onMarkReplied: () => void
}) {
  const s = (status || 'new').toLowerCase()
  return (
    <div className="admin-dashboard-actions">
      {s === 'new' ? (
        <button type="button" className="admin-dashboard-action-btn" onClick={onMarkRead}>
          Mark Read
        </button>
      ) : (
        <span className="admin-dashboard-action-done">Already Read</span>
      )}
      {s !== 'replied' ? (
        <button type="button" className="admin-dashboard-action-btn" onClick={onMarkReplied}>
          Mark Replied
        </button>
      ) : (
        <span className="admin-dashboard-action-done">Already Replied</span>
      )}
    </div>
  )
}

function userStatusLabel(s: string): string {
  const v = (s || 'active').toLowerCase()
  return v.charAt(0).toUpperCase() + v.slice(1)
}

function UserActionsCell({
  status,
  userId,
  onStop,
  onPause,
  onReactivate,
}: {
  status: string
  userId: number
  onStop: () => void
  onPause: () => void
  onReactivate: () => void
}) {
  const s = (status || 'active').toLowerCase()
  return (
    <div className="admin-dashboard-actions">
      {s === 'active' && (
        <>
          <button type="button" className="admin-dashboard-action-btn admin-dashboard-action-danger" onClick={onStop}>
            Stop
          </button>
          <button type="button" className="admin-dashboard-action-btn" onClick={onPause}>
            Pause
          </button>
        </>
      )}
      {s === 'paused' && (
        <>
          <button type="button" className="admin-dashboard-action-btn admin-dashboard-action-danger" onClick={onStop}>
            Stop
          </button>
          <button type="button" className="admin-dashboard-action-btn" onClick={onReactivate}>
            Reactivate
          </button>
        </>
      )}
      {s === 'stopped' && (
        <button type="button" className="admin-dashboard-action-btn" onClick={onReactivate}>
          Reactivate
        </button>
      )}
    </div>
  )
}

const AdminDashboard: React.FC = () => {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabId>('contact')
  const [users, setUsers] = useState<UserRow[]>([])
  const [supportRequests, setSupportRequests] = useState<MessageRow[]>([])
  const [contactMessages, setContactMessages] = useState<MessageRow[]>([])
  const [demoRequests, setDemoRequests] = useState<DemoRow[]>([])
  const [usersWithPlans, setUsersWithPlans] = useState<UserWithPlanRow[]>([])
  const [usageRows, setUsageRows] = useState<UsageRow[]>([])
  const [paymentRows, setPaymentRows] = useState<PaymentRow[]>([])
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [planModalUserId, setPlanModalUserId] = useState<number | null>(null)
  const [limitsModalUserId, setLimitsModalUserId] = useState<number | null>(null)
  const [addUserModalOpen, setAddUserModalOpen] = useState(false)
  const [addUserForm, setAddUserForm] = useState({ email: '', name: '', password: '' })
  const [addUserError, setAddUserError] = useState('')
  const [addUserSubmitting, setAddUserSubmitting] = useState(false)
  const [paymentsSortColumn, setPaymentsSortColumn] = useState<PaymentsSortKey>('createdAt')
  const [paymentsSortDir, setPaymentsSortDir] = useState<'asc' | 'desc'>('desc')
  const [planForm, setPlanForm] = useState({ planName: 'startpro', planType: 'monthly' })
  const [limitsForm, setLimitsForm] = useState({
    maxUsers: -1,
    maxWorkspaces: -1,
    maxQueriesPerMonth: -1,
    maxTablesPerDataSource: -1,
  })

  const token = localStorage.getItem('aiquery_token')
  const headers = token ? { Authorization: `Bearer ${token}` } : {}

  const loadUsers = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
      const res = await axios.get(`/api/admin/users?${params}`, { headers })
      if (res.data.success) setUsers(res.data.users || [])
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Failed to load users')
    } finally {
      setLoading(false)
    }
  }

  const loadSupportRequests = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
      if (statusFilter) params.set('status', statusFilter)
      const res = await axios.get(`/api/admin/support-requests?${params}`, { headers })
      if (res.data.success) setSupportRequests(res.data.items || [])
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Failed to load support requests')
    } finally {
      setLoading(false)
    }
  }

  const loadContactMessages = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
      if (statusFilter) params.set('status', statusFilter)
      const res = await axios.get(`/api/admin/contact-messages?${params}`, { headers })
      if (res.data.success) setContactMessages(res.data.items || [])
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Failed to load contact messages')
    } finally {
      setLoading(false)
    }
  }

  const loadDemoRequests = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
      if (statusFilter) params.set('status', statusFilter)
      const res = await axios.get(`/api/admin/demo-requests?${params}`, { headers })
      if (res.data.success) setDemoRequests(res.data.items || [])
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Failed to load demo requests')
    } finally {
      setLoading(false)
    }
  }

  const loadUsersWithPlans = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
      const res = await axios.get(`/api/admin/users-with-plans?${params}`, { headers })
      if (res.data.success) setUsersWithPlans(res.data.items || [])
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Failed to load users with plans')
    } finally {
      setLoading(false)
    }
  }

  const loadUsage = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
      const res = await axios.get(`/api/admin/usage?${params}`, { headers })
      if (res.data.success) setUsageRows(res.data.items || [])
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Failed to load usage')
    } finally {
      setLoading(false)
    }
  }

  const loadPayments = async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (searchDebounced.trim()) params.set('search', searchDebounced.trim())
      const res = await axios.get(`/api/admin/payments?${params}`, { headers })
      if (res.data.success) setPaymentRows(res.data.items || [])
    } catch (e: any) {
      setError(e.response?.data?.error || e.message || 'Failed to load payments')
    } finally {
      setLoading(false)
    }
  }

  // Debounce search to avoid excessive API calls
  const [searchDebounced, setSearchDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (activeTab === 'users') loadUsers()
    else if (activeTab === 'support') loadSupportRequests()
    else if (activeTab === 'contact') loadContactMessages()
    else if (activeTab === 'demo') loadDemoRequests()
    else if (activeTab === 'plans') loadUsersWithPlans()
    else if (activeTab === 'usage') loadUsage()
    else if (activeTab === 'payments') loadPayments()
  }, [activeTab, searchDebounced, statusFilter])

  const updateSupportStatus = async (id: number, status: string) => {
    try {
      await axios.patch(`/api/admin/support-requests/${id}`, { status }, { headers })
      setSupportRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to update')
    }
  }

  const updateContactStatus = async (id: number, status: string) => {
    try {
      await axios.patch(`/api/admin/contact-messages/${id}`, { status }, { headers })
      setContactMessages((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to update')
    }
  }

  const updateDemoStatus = async (id: number, status: string) => {
    try {
      await axios.patch(`/api/admin/demo-requests/${id}`, { status }, { headers })
      setDemoRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to update')
    }
  }

  const formatDate = (v?: string) => {
    if (!v) return '-'
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
  }

  const setUserPlan = async (userId: number, planName: string, planType: string) => {
    try {
      await axios.post(`/api/admin/users/${userId}/plan`, { planName, planType }, { headers })
      setPlanModalUserId(null)
      loadUsersWithPlans()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to set plan')
    }
  }

  const setUserLimits = async (userId: number) => {
    try {
      await axios.put(`/api/admin/user-plan-limits/${userId}`, limitsForm, { headers })
      setLimitsModalUserId(null)
      loadUsersWithPlans()
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to set limits')
    }
  }

  const createUser = async () => {
    setAddUserError('')
    const email = addUserForm.email.trim().toLowerCase()
    const name = addUserForm.name.trim()
    const password = addUserForm.password
    if (!email) {
      setAddUserError('Email is required.')
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAddUserError('Please enter a valid email address.')
      return
    }
    if (!password) {
      setAddUserError('Password is required.')
      return
    }
    if (password.length < 12) {
      setAddUserError('Password must be at least 12 characters.')
      return
    }
    setAddUserSubmitting(true)
    try {
      await axios.post('/api/admin/users', { email, name: name || undefined, password }, { headers })
      setAddUserModalOpen(false)
      setAddUserForm({ email: '', name: '', password: '' })
      loadUsers()
    } catch (e: any) {
      setAddUserError(e.response?.data?.error || 'Failed to create user')
    } finally {
      setAddUserSubmitting(false)
    }
  }

  const updateUserStatus = async (userId: number, status: 'active' | 'paused' | 'stopped') => {
    try {
      await axios.patch(`/api/admin/users/${userId}/status`, { status }, { headers })
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, status } : u)))
    } catch (e: any) {
      alert(e.response?.data?.error || 'Failed to update status')
    }
  }

  const openLimitsModal = (row: UserWithPlanRow) => {
    setLimitsModalUserId(row.id)
    setLimitsForm(
      row.customLimits
        ? { ...row.customLimits }
        : { maxUsers: -1, maxWorkspaces: -1, maxQueriesPerMonth: -1, maxTablesPerDataSource: -1 }
    )
  }

  const handlePaymentsSort = (key: PaymentsSortKey) => {
    if (paymentsSortColumn === key) {
      setPaymentsSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setPaymentsSortColumn(key)
      setPaymentsSortDir('asc')
    }
  }

  const sortedPaymentRows = React.useMemo(() => {
    const key = paymentsSortColumn
    const dir = paymentsSortDir
    return [...paymentRows].sort((a, b) => {
      let av: string | number
      let bv: string | number
      switch (key) {
        case 'id':
          av = a.id
          bv = b.id
          break
        case 'name':
          av = (a.name || a.userId).toString().toLowerCase()
          bv = (b.name || b.userId).toString().toLowerCase()
          break
        case 'email':
          av = a.email.toLowerCase()
          bv = b.email.toLowerCase()
          break
        case 'amount':
          av = a.amount
          bv = b.amount
          break
        case 'currency':
          av = a.currency.toLowerCase()
          bv = b.currency.toLowerCase()
          break
        case 'status':
          av = a.status.toLowerCase()
          bv = b.status.toLowerCase()
          break
        case 'planName':
          av = `${a.planName} ${a.planType}`.toLowerCase()
          bv = `${b.planName} ${b.planType}`.toLowerCase()
          break
        case 'itemType':
          av = a.itemType.toLowerCase()
          bv = b.itemType.toLowerCase()
          break
        case 'createdAt':
          av = new Date(a.createdAt).getTime()
          bv = new Date(b.createdAt).getTime()
          break
        default:
          return 0
      }
      if (av < bv) return dir === 'asc' ? -1 : 1
      if (av > bv) return dir === 'asc' ? 1 : -1
      return 0
    })
  }, [paymentRows, paymentsSortColumn, paymentsSortDir])

  const tabs: { id: TabId; label: string }[] = [
    { id: 'users', label: 'Users' },
    { id: 'plans', label: 'Plan Management' },
    { id: 'usage', label: 'Usage' },
    { id: 'payments', label: 'Payments' },
    { id: 'support', label: 'Support Requests' },
    { id: 'contact', label: 'Contact Messages' },
    { id: 'demo', label: 'Demo Requests' },
  ]

  return (
    <div className="admin-dashboard">
      <header className="admin-dashboard-header">
        <div className="admin-dashboard-header-left">
          <Logo imageSrc="/images/aiquery_logo5.png" imageOnly />
          <h1 className="admin-dashboard-title">Admin Dashboard</h1>
        </div>
        <div className="admin-dashboard-header-actions">
          <button className="admin-dashboard-back" onClick={() => navigate('/app_admin')}>
            Back to App
          </button>
        </div>
      </header>

      <div className="admin-dashboard-tabs">
        {tabs.map(({ id, label }) => (
          <button
            key={id}
            className={`admin-dashboard-tab ${activeTab === id ? 'active' : ''}`}
            onClick={() => setActiveTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="admin-dashboard-toolbar">
        <input
          type="text"
          className="admin-dashboard-search"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {(activeTab === 'support' || activeTab === 'contact' || activeTab === 'demo') && (
          <select
            className="admin-dashboard-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>
                {statusDisplayLabel(s)}
              </option>
            ))}
          </select>
        )}
      </div>

      {error && <div className="admin-dashboard-error">{error}</div>}
      {loading && <div className="admin-dashboard-loading">Loading...</div>}

      <div className="admin-dashboard-content">
        {activeTab === 'users' && !loading && (
          <div className="admin-dashboard-table-wrap">
            <div className="admin-dashboard-users-toolbar">
              <button
                type="button"
                className="admin-dashboard-add-user-btn"
                onClick={() => {
                  setAddUserModalOpen(true)
                  setAddUserError('')
                  setAddUserForm({ email: '', name: '', password: '' })
                }}
              >
                Add User
              </button>
            </div>
            <table className="admin-dashboard-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Phone_Number</th>
                  <th>Email_Verified</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.id}</td>
                    <td>{u.email}</td>
                    <td>{u.name || '-'}</td>
                    <td>{u.role || '-'}</td>
                    <td>{u.phone_number || '-'}</td>
                    <td>{u.email_verified === true ? 'Yes' : u.email_verified === false ? 'No' : '-'}</td>
                    <td className="admin-dashboard-status-label-cell">{userStatusLabel(u.status || 'active')}</td>
                    <td>{formatDate(u.created_at)}</td>
                    <td>{formatDate(u.updated_at)}</td>
                    <td>
                      <UserActionsCell
                        status={u.status || 'active'}
                        userId={u.id}
                        onStop={() => updateUserStatus(u.id, 'stopped')}
                        onPause={() => updateUserStatus(u.id, 'paused')}
                        onReactivate={() => updateUserStatus(u.id, 'active')}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {users.length === 0 && <p className="admin-dashboard-empty">No users found.</p>}
          </div>
        )}

        {activeTab === 'plans' && !loading && (
          <div className="admin-dashboard-table-wrap">
            <table className="admin-dashboard-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Plan</th>
                  <th>Type</th>
                  <th>Period End</th>
                  <th>Custom Limits</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {usersWithPlans.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.email}</td>
                    <td>{r.name || '-'}</td>
                    <td>{r.planName}</td>
                    <td>{r.planType}</td>
                    <td>{r.currentPeriodEnd ? formatDate(r.currentPeriodEnd) : '-'}</td>
                    <td className="admin-dashboard-message-cell">
                      {formatLimits(r.customLimits ?? PLAN_DEFAULT_LIMITS[r.planName] ?? PLAN_DEFAULT_LIMITS.free)}
                    </td>
                    <td>
                      <div className="admin-dashboard-actions">
                        <button
                          type="button"
                          className="admin-dashboard-action-btn"
                          onClick={() => {
                            setPlanModalUserId(r.id)
                            setPlanForm({ planName: r.planName, planType: r.planType })
                          }}
                        >
                          Change Plan
                        </button>
                        <button
                          type="button"
                          className="admin-dashboard-action-btn"
                          onClick={() => openLimitsModal(r)}
                        >
                          Set Limits
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {usersWithPlans.length === 0 && <p className="admin-dashboard-empty">No users found.</p>}
          </div>
        )}

        {activeTab === 'usage' && !loading && (
          <div className="admin-dashboard-table-wrap">
            <table className="admin-dashboard-table">
              <thead>
                <tr>
                  <th>User ID</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Plan</th>
                  <th>Workspaces</th>
                  <th>Users</th>
                  <th>Connections</th>
                  <th>Period Queries</th>
                  <th>Total Queries</th>
                  <th>Period Start</th>
                  <th>Period End</th>
                </tr>
              </thead>
              <tbody>
                {usageRows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.email}</td>
                    <td>{r.name || '-'}</td>
                    <td>{r.planName}</td>
                    <td>{r.workspaceCount}</td>
                    <td>{r.memberCount}</td>
                    <td>{r.connectionsCount}</td>
                    <td>{r.periodQueries}</td>
                    <td>{r.totalQueries}</td>
                    <td>{r.currentPeriodStart ? formatDate(r.currentPeriodStart) : '-'}</td>
                    <td>{r.currentPeriodEnd ? formatDate(r.currentPeriodEnd) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {usageRows.length === 0 && <p className="admin-dashboard-empty">No usage data found.</p>}
          </div>
        )}

        {activeTab === 'payments' && !loading && (
          <div className="admin-dashboard-table-wrap">
            <table className="admin-dashboard-table admin-dashboard-table-sortable">
              <thead>
                <tr>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('id')}>
                    ID {paymentsSortColumn === 'id' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('name')}>
                    User {paymentsSortColumn === 'name' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('email')}>
                    Email {paymentsSortColumn === 'email' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('amount')}>
                    Amount {paymentsSortColumn === 'amount' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('currency')}>
                    Currency {paymentsSortColumn === 'currency' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('status')}>
                    Status {paymentsSortColumn === 'status' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('planName')}>
                    Plan {paymentsSortColumn === 'planName' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('itemType')}>
                    Item Type {paymentsSortColumn === 'itemType' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                  <th>Billing Period</th>
                  <th className="admin-dashboard-th-sortable" onClick={() => handlePaymentsSort('createdAt')}>
                    Created {paymentsSortColumn === 'createdAt' && (paymentsSortDir === 'asc' ? ' ↑' : ' ↓')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sortedPaymentRows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.name || r.userId}</td>
                    <td>{r.email}</td>
                    <td>{r.amount.toFixed(2)}</td>
                    <td>{r.currency}</td>
                    <td>{r.status}</td>
                    <td>{r.planName} ({r.planType})</td>
                    <td>{r.itemType}</td>
                    <td>
                      {r.billingPeriodStart && r.billingPeriodEnd
                        ? `${formatDate(r.billingPeriodStart).slice(0, 10)} – ${formatDate(r.billingPeriodEnd).slice(0, 10)}`
                        : '-'}
                    </td>
                    <td>{formatDate(r.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {paymentRows.length === 0 && <p className="admin-dashboard-empty">No payments found.</p>}
          </div>
        )}

        {activeTab === 'support' && !loading && (
          <div className="admin-dashboard-table-wrap">
            <table className="admin-dashboard-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Subject</th>
                  <th>Status</th>
                  <th>Actions</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {supportRequests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.email}</td>
                    <td>{r.name || '-'}</td>
                    <td>{r.subject || '-'}</td>
                    <td className="admin-dashboard-status-label-cell">{statusDisplayLabel(r.status)}</td>
                    <td>
                      <ActionsCell
                        status={r.status}
                        onMarkRead={() => updateSupportStatus(r.id, 'read')}
                        onMarkReplied={() => updateSupportStatus(r.id, 'replied')}
                      />
                    </td>
                    <td>{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {supportRequests.length === 0 && <p className="admin-dashboard-empty">No support requests found.</p>}
          </div>
        )}

        {activeTab === 'contact' && !loading && (
          <div className="admin-dashboard-table-wrap">
            <table className="admin-dashboard-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Subject</th>
                  <th>Message</th>
                  <th>Status</th>
                  <th>Actions</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {contactMessages.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.email}</td>
                    <td>{r.name || '-'}</td>
                    <td>{r.subject || '-'}</td>
                    <td className="admin-dashboard-message-cell">
                      {(r.message || '').slice(0, 80)}
                      {(r.message || '').length > 80 ? '…' : ''}
                    </td>
                    <td className="admin-dashboard-status-label-cell">{statusDisplayLabel(r.status)}</td>
                    <td>
                      <ActionsCell
                        status={r.status}
                        onMarkRead={() => updateContactStatus(r.id, 'read')}
                        onMarkReplied={() => updateContactStatus(r.id, 'replied')}
                      />
                    </td>
                    <td>{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {contactMessages.length === 0 && <p className="admin-dashboard-empty">No contact messages found.</p>}
          </div>
        )}

        {activeTab === 'demo' && !loading && (
          <div className="admin-dashboard-table-wrap">
            <table className="admin-dashboard-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Email</th>
                  <th>Name</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th>Actions</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {demoRequests.map((r) => (
                  <tr key={r.id}>
                    <td>{r.id}</td>
                    <td>{r.email}</td>
                    <td>
                      {[r.first_name, r.last_name].filter(Boolean).join(' ') || '-'}
                    </td>
                    <td>{r.company_name || '-'}</td>
                    <td className="admin-dashboard-status-label-cell">{statusDisplayLabel(r.status)}</td>
                    <td>
                      <ActionsCell
                        status={r.status}
                        onMarkRead={() => updateDemoStatus(r.id, 'read')}
                        onMarkReplied={() => updateDemoStatus(r.id, 'replied')}
                      />
                    </td>
                    <td>{formatDate(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {demoRequests.length === 0 && <p className="admin-dashboard-empty">No demo requests found.</p>}
          </div>
        )}
      </div>

      {planModalUserId !== null && (
        <div className="admin-dashboard-modal-overlay" onClick={() => setPlanModalUserId(null)}>
          <div className="admin-dashboard-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Change Plan</h3>
            <p className="admin-dashboard-modal-hint">Set or upgrade this user&apos;s plan.</p>
            <div className="admin-dashboard-modal-form">
              <label>
                Plan
                <select
                  value={planForm.planName}
                  onChange={(e) => setPlanForm((f) => ({ ...f, planName: e.target.value }))}
                >
                  {PLAN_NAMES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Type
                <select
                  value={planForm.planType}
                  onChange={(e) => setPlanForm((f) => ({ ...f, planType: e.target.value }))}
                >
                  <option value="monthly">Monthly</option>
                  <option value="annual">Annual</option>
                </select>
              </label>
            </div>
            <div className="admin-dashboard-modal-actions">
              <button type="button" className="admin-dashboard-action-btn" onClick={() => setPlanModalUserId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-dashboard-modal-submit"
                onClick={() => setUserPlan(planModalUserId, planForm.planName, planForm.planType)}
              >
                Save Plan
              </button>
            </div>
          </div>
        </div>
      )}

      {limitsModalUserId !== null && (
        <div className="admin-dashboard-modal-overlay" onClick={() => setLimitsModalUserId(null)}>
          <div className="admin-dashboard-modal admin-dashboard-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Set Custom Limits (Enterprise)</h3>
            <p className="admin-dashboard-modal-hint">Use -1 for unlimited. These apply when the user is on the Enterprise plan.</p>
            <div className="admin-dashboard-modal-form admin-dashboard-modal-form-grid">
              <label>
                Max Users
                <input
                  type="number"
                  min={-1}
                  value={limitsForm.maxUsers === -1 ? '' : limitsForm.maxUsers}
                  placeholder="-1 = unlimited"
                  onChange={(e) =>
                    setLimitsForm((f) => ({
                      ...f,
                      maxUsers: e.target.value === '' ? -1 : parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </label>
              <label>
                Max Workspaces
                <input
                  type="number"
                  min={-1}
                  value={limitsForm.maxWorkspaces === -1 ? '' : limitsForm.maxWorkspaces}
                  placeholder="-1 = unlimited"
                  onChange={(e) =>
                    setLimitsForm((f) => ({
                      ...f,
                      maxWorkspaces: e.target.value === '' ? -1 : parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </label>
              <label>
                Max Queries / Month
                <input
                  type="number"
                  min={-1}
                  value={limitsForm.maxQueriesPerMonth === -1 ? '' : limitsForm.maxQueriesPerMonth}
                  placeholder="-1 = unlimited"
                  onChange={(e) =>
                    setLimitsForm((f) => ({
                      ...f,
                      maxQueriesPerMonth: e.target.value === '' ? -1 : parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </label>
              <label>
                Max Tables per Data Source
                <input
                  type="number"
                  min={-1}
                  value={limitsForm.maxTablesPerDataSource === -1 ? '' : limitsForm.maxTablesPerDataSource}
                  placeholder="-1 = unlimited"
                  onChange={(e) =>
                    setLimitsForm((f) => ({
                      ...f,
                      maxTablesPerDataSource: e.target.value === '' ? -1 : parseInt(e.target.value, 10) || 0,
                    }))
                  }
                />
              </label>
            </div>
            <div className="admin-dashboard-modal-actions">
              <button type="button" className="admin-dashboard-action-btn" onClick={() => setLimitsModalUserId(null)}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-dashboard-modal-submit"
                onClick={() => limitsModalUserId && setUserLimits(limitsModalUserId)}
              >
                Save Limits
              </button>
            </div>
          </div>
        </div>
      )}

      {addUserModalOpen && (
        <div className="admin-dashboard-modal-overlay" onClick={() => !addUserSubmitting && setAddUserModalOpen(false)}>
          <div className="admin-dashboard-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Add User</h3>
            <p className="admin-dashboard-modal-hint">Create a new user (e.g. for a custom plan). You can then assign a plan in Plan Management.</p>
            <div className="admin-dashboard-modal-form">
              <label>
                Email *
                <input
                  type="email"
                  value={addUserForm.email}
                  onChange={(e) => setAddUserForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="user@example.com"
                />
              </label>
              <label>
                Name
                <input
                  type="text"
                  value={addUserForm.name}
                  onChange={(e) => setAddUserForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Optional"
                />
              </label>
              <label>
                Password * (min 12 chars, upper, lower, number, special)
                <input
                  type="password"
                  value={addUserForm.password}
                  onChange={(e) => setAddUserForm((f) => ({ ...f, password: e.target.value }))}
                  placeholder="Set initial password"
                />
              </label>
            </div>
            {addUserError && <div className="admin-dashboard-error admin-dashboard-modal-error">{addUserError}</div>}
            <div className="admin-dashboard-modal-actions">
              <button type="button" className="admin-dashboard-action-btn" onClick={() => setAddUserModalOpen(false)} disabled={addUserSubmitting}>
                Cancel
              </button>
              <button
                type="button"
                className="admin-dashboard-modal-submit"
                onClick={createUser}
                disabled={addUserSubmitting}
              >
                {addUserSubmitting ? 'Creating...' : 'Create User'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AdminDashboard
