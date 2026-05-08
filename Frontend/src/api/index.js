import axios from 'axios'

const api = axios.create({ baseURL: '/api' })

// Always attach token from localStorage
api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('dms_token')
  if (token) {
    cfg.headers.Authorization = `Bearer ${token}`
  }
  return cfg
})

// On 401: only redirect if token is truly gone (not just missing on this request)
api.interceptors.response.use(
  response => response,
  error => {
    if (error.response?.status === 401) {
      const isAuthEndpoint = error.config?.url?.includes('/auth/login') ||
                             error.config?.url?.includes('/auth/config') ||
                             error.config?.url?.includes('/auth/verify')
      const hasToken = !!localStorage.getItem('dms_token')

      // Workflow action / initiate 401 = wrong password digital-signature
      // failure (not session expiry) — do NOT logout, let the modal show the
      // error inline.
      const isWorkflowAction = error.config?.url?.includes('/workflow/') &&
                               (error.config?.url?.includes('/action') ||
                                error.config?.url?.includes('/return') ||
                                error.config?.url?.includes('/initiate'))

      // Only clear and redirect if this wasn't an auth endpoint or workflow action
      // AND we actually had a token (meaning it expired/was rejected)
      if (!isAuthEndpoint && !isWorkflowAction && hasToken) {
        localStorage.removeItem('dms_token')
        localStorage.removeItem('dms_user')
        window.location.href = '/login'
      }
    }
    return Promise.reject(error)
  }
)

// ─── Auth ─────────────────────────────────────────────────────────────────────
export const authAPI = {
  config:      ()                      => api.get('/auth/config'),
  verifyCode:  (code)                  => api.post('/auth/verify-code', { code }),
  login:       (email, password, gate) => {
    const form = new FormData()
    form.append('username', email)
    form.append('password', password)
    const headers = gate ? { 'X-Gate-Token': gate } : {}
    return api.post('/auth/login', form, { headers })
  },
  me:                   ()       => api.get('/auth/me'),
  register:             (data)   => api.post('/auth/register', data),
  ssoMetadata:          ()       => api.get('/auth/sso/metadata'),
  uploadProfilePicture:  (formData) => api.post('/auth/profile/picture', formData),
  removeProfilePicture:  ()         => api.delete('/auth/profile/picture'),
}

// ─── Documents ────────────────────────────────────────────────────────────────
export const documentsAPI = {
  list:          (params)              => api.get('/documents/', { params }),
  get:           (id)                  => api.get(`/documents/${id}`),
  create:        (formData)            => api.post('/documents/', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  update:        (id, data)            => api.patch(`/documents/${id}`, data),
  delete:        (id)                  => api.delete(`/documents/${id}`),
  checkout:      (id, action)          => api.post(`/documents/${id}/checkout`, { action }),
  uploadVersion: (id, formData)        => api.post(`/documents/${id}/versions`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  }),
  downloadFile:  (docId, fileId)       => api.get(`/documents/${docId}/files/${fileId}/download`, {
    responseType: 'blob'
  }),
  addFeedback:   (id, comment, taggedUserId) => api.post(`/documents/${id}/feedback`, { comment, tagged_user_id: taggedUserId || null }),
  addReference:  (id, targetId, note)  => api.post(`/documents/${id}/references`, {
    target_doc_id: targetId, note
  }),
  getShareLink:  (id, version)         => api.get(`/documents/${id}/share-link`, {
    params: { version }
  }),
  addFile:       (docId, formData)      => api.post(`/documents/${docId}/files`, formData),
  deleteFile:    (docId, fileId)       => api.delete(`/documents/${docId}/files/${fileId}`),
  reassignDocNumber:(id, project, usi)    => api.post(`/documents/${id}/reassign`, { project, usi_kks_code: usi }),
  flagDeletion:     (id)                  => api.post(`/documents/${id}/flag-deletion`),
  unflagDeletion:   (id)                  => api.delete(`/documents/${id}/flag-deletion`),
  fileAccessStats:  (id)                  => api.get(`/documents/${id}/file-access-stats`),
  searchUsers:      (q)                   => api.get('/users/search', { params: { q } }),
  getEditors:       (id)                  => api.get(`/documents/${id}/editors`),
  setEditors:       (id, editorIds)       => api.put(`/documents/${id}/editors`, { editor_ids: editorIds }),
  requestEditAccess:(id, message)         => api.post(`/documents/${id}/request-edit-access`, { message }),
  incomingAccessRequests: ()              => api.get('/access-requests/incoming'),
  decideAccessRequest:    (id, action)    => api.post(`/access-requests/${id}/decide`, { action }),
}

// ─── Workflow ─────────────────────────────────────────────────────────────────
export const workflowAPI = {
  inbox:     ()                  => api.get('/workflow/inbox'),
  pending:   ()                  => api.get('/workflow/pending'),
  submit:    (docId)             => api.post(`/workflow/${docId}/submit`),
  initiate:  (docId, data)       => api.post(`/workflow/${docId}/initiate`, data),
  action:    (docId, data)       => api.post(`/workflow/${docId}/action`, data),
  checklist: (docId, data)       => api.post(`/workflow/${docId}/checklist`, data),
  return:    (docId, data)       => api.post(`/workflow/${docId}/return`, data),
  assign:    (docId, step, uid)  => api.post(`/workflow/${docId}/assign`, {
    step, assignee_id: uid
  }),
  status:           (docId)               => api.get(`/workflow/${docId}/status`),
  uploadTemplate:   (docId, levelId, fd)  => api.post(`/workflow/${docId}/checklist-template/${levelId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  downloadTemplate: (docId, levelId)      => api.get(`/workflow/${docId}/checklist-template/${levelId}/download`, { responseType: 'blob' }),
  submitChecklist:  (docId, taskId, fd)   => api.post(`/workflow/${docId}/checklist-submit/${taskId}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  downloadChecklist:(docId, taskId)       => api.get(`/workflow/${docId}/checklist-submit/${taskId}/download`, { responseType: 'blob' }),
  adminForceReset:  (docId, note)         => api.post(`/workflow/${docId}/admin-force-reset`, { note }),
  adminReassign:    (docId, assigneeId)   => api.post(`/workflow/${docId}/admin-reassign`, { assignee_id: assigneeId }),
  adminFixStatus:   (docId)              => api.post(`/workflow/${docId}/admin-fix-status`),
}

// ─── Reports ──────────────────────────────────────────────────────────────────
export const reportsAPI = {
  summary:       ()       => api.get('/reports/summary'),
  byStatus:      ()       => api.get('/reports/by-status'),
  byType:        ()       => api.get('/reports/by-type'),
  byTypeStatus:  ()       => api.get('/reports/by-type-status'),
  expiring:      (days)   => api.get('/reports/expiring', { params: { days } }),
  audit:         (params) => api.get('/reports/audit', { params }),
}

// ─── Alerts ───────────────────────────────────────────────────────────────────
export const alertsAPI = {
  upcoming:     (days = 90) => api.get('/alerts/upcoming', { params: { days } }),
  logs:         (params)    => api.get('/alerts/logs', { params }),
  configs:      ()          => api.get('/alerts/config'),
  updateConfig: (dtId, data) => api.put(`/alerts/config/${dtId}`, data),
  runJob:       ()          => api.post('/alerts/run-job'),
}

// ─── Admin ────────────────────────────────────────────────────────────────────
export const adminAPI = {
  listUsers:        (params)     => api.get('/admin/users', { params }),
  createUser:       (data)       => api.post('/admin/users', data),
  updateUser:       (id, data)   => api.put(`/admin/users/${id}`, data),
  deactivateUser:   (id)         => api.delete(`/admin/users/${id}`),
  activateUser:     (id)         => api.post(`/admin/users/${id}/activate`),
  listDocTypes:     ()           => api.get('/admin/document-types'),
  createDocType:    (data)       => api.post('/admin/document-types', data),
  updateDocType:    (id, data)   => api.put(`/admin/document-types/${id}`, data),
  listWfConfigs:    ()           => api.get('/admin/workflow-configs'),
  updateWfConfig:   (dtId, data) => api.put(`/admin/workflow-configs/${dtId}`, data),
  listRoles:        ()           => api.get('/admin/roles'),
  createRole:       (data)       => api.post('/admin/roles', data),
  listReservations:   ()      => api.get('/admin/number-reservations'),
  reserveNumbers:     (data)  => api.post('/admin/number-reservations', data),
  getConfig:          ()      => api.get('/admin/config'),
  saveConfig:         (data)  => api.put('/admin/config', data),
  seed:               ()      => api.post('/admin/seed'),
  flaggedDocuments:       ()              => api.get('/admin/flagged-documents'),
  runDeletionJob:         ()              => api.post('/admin/run-deletion-job'),
  logsSummary:            ()              => api.get('/admin/logs/summary'),
  deletionLogs:           (params)        => api.get('/admin/logs/deletions', { params }),
  creationLogs:           (params)        => api.get('/admin/logs/creations', { params }),
  deletionLogsDownload:   (params = {})   => `/api/admin/logs/deletions/download?${new URLSearchParams(params)}`,
  creationLogsDownload:   (params = {})   => `/api/admin/logs/creations/download?${new URLSearchParams(params)}`,
}

// ─── Document Library ─────────────────────────────────────────────────────────
export const libraryAPI = {
  tree:              ()           => api.get('/library/tree'),
  folders:           (params)     => api.get('/library/folders', { params }),
  createFolder:      (data)       => api.post('/library/folders', data),
  getFolder:         (id)         => api.get(`/library/folders/${id}`),
  updateFolder:      (id, data)   => api.put(`/library/folders/${id}`, data),
  deleteFolder:      (id)         => api.delete(`/library/folders/${id}`),
  folderDocuments:   (id)         => api.get(`/library/folders/${id}/documents`),
  docTypeDocuments:  (id)         => api.get(`/library/doc-types/${id}/documents`),
}

export default api
