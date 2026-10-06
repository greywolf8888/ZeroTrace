// 保持既有证据规范序列化逐字行为；纯模块同时供Node与浏览器使用。
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Value is not JSON serializable.');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .flatMap((key) => {
      const item = record[key];
      if (item === undefined) return [];
      return [`${JSON.stringify(key)}:${canonicalJson(item)}`];
    })
    .join(',')}}`;
}
