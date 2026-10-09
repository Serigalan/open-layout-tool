import { describe, it, expect } from 'vitest'
import { parseXml, child } from './e57Xml'

describe('parseXml', () => {
  it('reads elements, attributes, CDATA and entities', () => {
    const root = parseXml(`<?xml version="1.0"?>
      <!-- a comment -->
      <e57Root type="Structure" xmlns:las="http://x">
        <name type="String"><![CDATA[Scan <1> & more]]></name>
        <cartesianX type="ScaledInteger" minimum='-5' maximum="5" scale="1e-3"/>
        <note type="String">a &lt; b &amp; c &#65;</note>
        <las:pointSourceId type="Integer" minimum="0" maximum="65535"/>
        <empty type="Integer"></empty>
      </e57Root>`)
    expect(root.name).toBe('e57Root')
    expect(child(root, 'name').text).toBe('Scan <1> & more')
    expect(child(root, 'cartesianX').attrs).toEqual({ type: 'ScaledInteger', minimum: '-5', maximum: '5', scale: '1e-3' })
    expect(child(root, 'note').text).toBe('a < b & c A')
    expect(child(root, 'las:pointSourceId').attrs.maximum).toBe('65535')
    expect(child(root, 'empty').text.trim()).toBe('')
    expect(root.children.map(c => c.name)).toEqual(['name', 'cartesianX', 'note', 'las:pointSourceId', 'empty'])
  })

  it('throws on a tag that does not close', () => {
    expect(() => parseXml('<a><b></a>')).toThrow(/E57 XML/)
    expect(() => parseXml('<a>')).toThrow(/unclosed/)
  })
})
