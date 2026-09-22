const BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || JSON.stringify(body);
    } catch {
      /* ignore */
    }
    throw new Error(`${res.status}: ${detail}`);
  }
  const contentType = res.headers.get("content-type") || "";
  return contentType.includes("application/json") ? res.json() : res.text();
}

export const api = {
  createUser: (data) => request("/users/", { method: "POST", body: JSON.stringify(data) }),
  getUser: (id) => request(`/users/${id}`),
  googleSignIn: (credential) => request("/auth/google", { method: "POST", body: JSON.stringify({ credential }) }),

  getProfile: (userId) => request(`/users/${userId}/profile/`),
  upsertProfile: (userId, data, exists) =>
    request(`/users/${userId}/profile/`, { method: exists ? "PUT" : "POST", body: JSON.stringify(data) }),

  listResumes: (userId) => request(`/users/${userId}/resumes/`),
  getMasterResume: (userId) => request(`/users/${userId}/resumes/master`),
  setMasterResume: (userId, data) => request(`/users/${userId}/resumes/set-master`, { method: "POST", body: JSON.stringify(data) }),
  createResume: (userId, data) => request(`/users/${userId}/resumes/`, { method: "POST", body: JSON.stringify(data) }),
  uploadResume: (userId, title, file) => {
    const form = new FormData();
    form.append("file", file);
    return fetch(`${BASE_URL}/users/${userId}/resumes/upload?title=${encodeURIComponent(title)}`, {
      method: "POST",
      body: form,
    }).then(async (r) => {
      if (!r.ok) throw new Error(await r.text());
      return r.json();
    });
  },
  tailorResume: (userId, data) => request(`/users/${userId}/resumes/tailor`, { method: "POST", body: JSON.stringify(data) }),
  exportResume: (userId, data) => request(`/users/${userId}/resumes/export`, { method: "POST", body: JSON.stringify(data) }),
  resumeDownloadUrl: (userId, filename) => `${BASE_URL}/users/${userId}/resumes/download/${filename}`,

  aiStatus: () => request("/ai/status"),
  analyzeResume: (data) => request("/ai/resume/analyze", { method: "POST", body: JSON.stringify(data) }),
  matchJob: (data) => request("/ai/job/match", { method: "POST", body: JSON.stringify(data) }),
  skillGap: (data) => request("/ai/skills/gap", { method: "POST", body: JSON.stringify(data) }),
  learning: (data) => request("/ai/learning", { method: "POST", body: JSON.stringify(data) }),
  interviewQuestions: (kind, jd, n = 4) =>
    request(`/ai/interview/questions?kind=${encodeURIComponent(kind)}&job_description=${encodeURIComponent(jd)}&n=${n}`),
  chat: (data) => request("/ai/chat", { method: "POST", body: JSON.stringify(data) }),
  agentPrepare: (data) => request("/ai/agent/prepare", { method: "POST", body: JSON.stringify(data) }),

  discoverJobs: (query, limit = 20) => request(`/jobs/discover?query=${encodeURIComponent(query)}&limit=${limit}`),
  discoverRanked: (query, limit = 20, { userId, profileText } = {}) => {
    const params = new URLSearchParams({ query, limit: String(limit) });
    if (userId) params.set("user_id", userId);
    if (profileText) params.set("profile_text", profileText);
    return request(`/jobs/discover/ranked?${params.toString()}`);
  },
  parseJobLink: (url) => request("/jobs/link", { method: "POST", body: JSON.stringify({ url }) }),
  autofillApplication: (url, profile, headless = false) =>
    request(`/jobs/application/autofill?url=${encodeURIComponent(url)}&headless=${headless}`, {
      method: "POST",
      body: JSON.stringify(profile),
    }),

  listApplications: (userId, status) =>
    request(`/users/${userId}/applications/${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  createApplication: (userId, data) =>
    request(`/users/${userId}/applications/`, { method: "POST", body: JSON.stringify(data) }),
  updateApplicationStatus: (userId, appId, status) =>
    request(`/users/${userId}/applications/${appId}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  deleteApplication: (userId, appId) => request(`/users/${userId}/applications/${appId}`, { method: "DELETE" }),
  applicationsSummary: (userId) => request(`/users/${userId}/applications/summary`),

  submitInterviewAnswer: (data) => request("/interview/answer", { method: "POST", body: JSON.stringify(data) }),
  evaluateAnswerPreview: (question, answer, expected_topics = []) =>
    request("/ai/interview/evaluate-preview", { method: "POST", body: JSON.stringify({ question, answer, expected_topics }) }),
  interviewHistory: (userId) => request(`/interview/history/${userId}`),

  // Profile auto-detect from resume
  autoDetectProfile: (userId, data) => request(`/users/${userId}/profile/from-resume`, { method: "POST", body: JSON.stringify(data) }),

  // Guest (no-login) resume tools
  guestTailorResume: (data) => request("/resume-tools/tailor", { method: "POST", body: JSON.stringify(data) }),
  guestExportResume: (data) => request("/resume-tools/export", { method: "POST", body: JSON.stringify(data) }),
  guestParsePreview: (resumeText) => request("/resume-tools/parse-preview", { method: "POST", body: JSON.stringify({ resume_text: resumeText }) }),
  guestDownloadUrl: (filename) => `${BASE_URL}/resume-tools/download/${filename}`,
  guestAutofill: (data) => request("/resume-tools/application/autofill", { method: "POST", body: JSON.stringify(data) }),

  // Auto-apply (account-aware autofill)
  autofillWithAccount: (data) => request("/jobs/application/autofill", { method: "POST", body: JSON.stringify(data) }),
};
