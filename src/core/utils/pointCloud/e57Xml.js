/**
 * The XML section of an E57 file as a tree — a parser just big enough for it,
 * because the import runs in a Web Worker, which has no DOMParser. Elements,
 * attributes, text and CDATA; declarations, comments and doctypes are passed
 * over. A node is `{ name, attrs, children, text }`, its name as written
 * (an extension's prefix included, `las:pointSourceId`).
 */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }

const decode = (s) => (s.includes('&')
  ? s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)))
    return ENTITIES[e] ?? m
  })
  : s)

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g

/** The root element of `xml`. Throws on what is not well formed enough to read. */
export function parseXml(xml) {
  const root = { name: '#document', attrs: {}, children: [], text: '' }
  const stack = [root]
  let i = 0
  const fail = (what) => { throw new Error(`E57 XML: ${what} at ${i}`) }
  while (i < xml.length) {
    const lt = xml.indexOf('<', i)
    const top = stack[stack.length - 1]
    if (lt < 0) { top.text += decode(xml.slice(i)); break }
    if (lt > i) top.text += decode(xml.slice(i, lt))
    i = lt
    if (xml.startsWith('<![CDATA[', i)) {
      const end = xml.indexOf(']]>', i)
      if (end < 0) fail('open CDATA')
      top.text += xml.slice(i + 9, end)
      i = end + 3
    } else if (xml.startsWith('<!--', i)) {
      const end = xml.indexOf('-->', i)
      if (end < 0) fail('open comment')
      i = end + 3
    } else if (xml.startsWith('<?', i)) {
      const end = xml.indexOf('?>', i)
      if (end < 0) fail('open declaration')
      i = end + 2
    } else if (xml.startsWith('<!', i)) {
      const end = xml.indexOf('>', i)
      if (end < 0) fail('open doctype')
      i = end + 1
    } else if (xml[i + 1] === '/') {
      const end = xml.indexOf('>', i)
      if (end < 0) fail('open end tag')
      const name = xml.slice(i + 2, end).trim()
      if (stack.length < 2 || top.name !== name) fail(`unexpected </${name}>`)
      stack.pop()
      i = end + 1
    } else {
      // Attribute values may hold '>', so the tag ends at the first '>' outside quotes.
      let j = i + 1, quote = null
      for (; j < xml.length; j++) {
        const c = xml[j]
        if (quote) { if (c === quote) quote = null } else if (c === '"' || c === "'") quote = c
        else if (c === '>') break
      }
      if (j >= xml.length) fail('open tag')
      const selfClosing = xml[j - 1] === '/'
      const body = xml.slice(i + 1, selfClosing ? j - 1 : j)
      const name = body.match(/^[^\s/>]+/)?.[0]
      if (!name) fail('nameless tag')
      const attrs = {}
      for (const m of body.slice(name.length).matchAll(ATTR)) attrs[m[1]] = decode(m[3] ?? m[4])
      const node = { name, attrs, children: [], text: '' }
      top.children.push(node)
      if (!selfClosing) stack.push(node)
      i = j + 1
    }
  }
  if (stack.length !== 1) fail(`unclosed <${stack[stack.length - 1].name}>`)
  const element = root.children[0]
  if (!element) fail('no root element')
  return element
}

/** The child of `node` named `name`, or undefined. */
export const child = (node, name) => node?.children.find(c => c.name === name)
