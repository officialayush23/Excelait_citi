/** One place for every in-app URL, so all pages link to each other the same way. */
export const to = {
  saathi: () => '/app',
  careers: () => '/app/careers',
  career: (slug: string) => `/app/careers/${slug}`,
  course: (slug: string) => `/app/courses/${slug}`,
  exam: (slug: string) => `/app/exams/${slug}`,
  money: () => '/app/money',
  scheme: (slug: string) => `/app/money?scheme=${slug}`,
  colleges: (q?: { kind?: string; state?: string; district?: string }) =>
    `/app/colleges${q ? `?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}` : ''}`,
  college: (code: string) => `/app/colleges/${code}`,
  learn: (q?: { career?: string; course?: string; exam?: string }) =>
    `/app/learn${q ? `?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}` : ''}`,
  plan: () => '/app/plan',
  planItem: (id: string) => `/app/plan/${id}`,
  opportunities: (id?: string) => (id ? `/app/opportunities?id=${id}` : '/app/opportunities'),
  community: (q?: { career?: string; exam?: string; kind?: string }) =>
    `/app/community${q ? `?${new URLSearchParams(Object.entries(q).filter(([, v]) => v) as [string, string][])}` : ''}`,
  post: (id: string) => `/app/community/${id}`,
  start: () => '/app/start',
}
