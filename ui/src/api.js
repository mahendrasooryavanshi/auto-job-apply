async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    ...options,
    // X-Job-Agent proves the request comes from this dashboard (the server rejects changes without it)
    headers: { "Content-Type": "application/json", ...(options.headers || {}), "X-Job-Agent": "1" },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
  return data;
}

export const api = {
  summary: () => request("/summary"),
  jobs: () => request("/jobs"),
  activity: () => request("/activity"),
  updateJob: (id, fields) => request(`/jobs/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  bulkStatus: (ids, status) => request("/jobs/bulk-status", { method: "POST", body: JSON.stringify({ ids, status }) }),
  startAction: (name) => request(`/actions/${name}`, { method: "POST" }),
  settings: () => request("/settings"),
  saveSettings: (data) => request("/settings", { method: "PUT", body: JSON.stringify(data) }),
  clearSecret: (key) => request(`/settings/secrets/${key}`, { method: "DELETE" }),
  profile: () => request("/profile"),
  uploadLinkedinPdf: (file) =>
    request("/profile/linkedin-pdf", { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file }),
  makeProfile: (current) => request("/profile", { method: "POST", body: JSON.stringify(current) }),
  hr: () => request("/hr"),
  hrAdd: (contacts) => request("/hr", { method: "POST", body: JSON.stringify(contacts) }),
  hrImport: (file) => request(`/hr/import?filename=${encodeURIComponent(file.name)}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file,
  }),
  hrPaste: (text) => request("/hr/import?filename=pasted.txt", {
    method: "POST", headers: { "Content-Type": "text/plain" }, body: text,
  }),
  hrUpdate: (id, fields) => request(`/hr/${id}`, { method: "PATCH", body: JSON.stringify(fields) }),
  hrBulk: (ids, action, emails) => request("/hr/bulk", { method: "POST", body: JSON.stringify({ ids, action, emails }) }),
  hrOpen: () => request("/hr/open", { method: "POST" }),
  hrDelete: (id) => request(`/hr/${id}`, { method: "DELETE" }),
  hrTemplate: (t) => request("/hr/template", { method: "PUT", body: JSON.stringify(t) }),
  linkedin: () => request("/linkedin"),
  linkedinDraft: (kind, topic) => request("/linkedin/draft", { method: "POST", body: JSON.stringify({ kind, topic }) }),
  linkedinPost: (text) => request("/linkedin/post", { method: "POST", body: JSON.stringify({ text }) }),
  linkedinDisconnect: () => request("/linkedin/disconnect", { method: "POST" }),
  testGmail: () => request("/settings/test-gmail", { method: "POST" }),
  uploadResume: (file) =>
    request(`/settings/resume?filename=${encodeURIComponent(file.name)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: file,
    }),
};
