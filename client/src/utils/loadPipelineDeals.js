export async function loadPipelineDeals(api, params) {
  const pageSize = 500;
  const deals = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data } = await api.get('/deals', { params: { ...params, limit: pageSize, offset } });
    const page = Array.isArray(data) ? data : [];
    deals.push(...page);
    if (page.length < pageSize) break;
  }
  return [...new Map(deals.map((deal) => [deal.id, deal])).values()];
}
