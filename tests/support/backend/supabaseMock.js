// Giả lập query builder của supabase-js: mọi hàm lọc trả về chính nó, await (hoặc single/maybeSingle) trả `result`.
const CHAIN_METHODS = ['select', 'insert', 'update', 'delete', 'upsert', 'eq', 'order', 'range', 'limit', 'or']

function query(result = { data: null, error: null }) {
  const q = {}
  for (const method of CHAIN_METHODS) {
    q[method] = jest.fn(() => q)
  }
  q.single = jest.fn(() => Promise.resolve(result))
  q.maybeSingle = jest.fn(() => Promise.resolve(result))
  q.then = (onFulfilled, onRejected) => Promise.resolve(result).then(onFulfilled, onRejected)
  return q
}

// Mỗi lần gọi supabaseAdmin.from(table) lấy query kế tiếp trong hàng đợi; trả về danh sách để kiểm tra lời gọi.
function queueFrom(fromMock, ...results) {
  const queries = results.map(query)
  for (const q of queries) {
    fromMock.mockReturnValueOnce(q)
  }
  return queries
}

module.exports = { query, queueFrom }
