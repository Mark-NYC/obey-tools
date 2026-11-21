import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const context = { window: {} }
for (const file of ['daily-sos-scripture.js', 'daily-sos-readings.js']) {
  vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), context, { filename: file })
}
const bible = context.window.OBEY_WEBU
const plan = context.window.OBEY_SOS_READINGS

function primaryVerses(reference) {
  const match = reference.replace(/[–—]/g, '-').match(/^(.+?)\s+(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/)
  assert.ok(match, 'Invalid Scripture reference: ' + reference)
  const [, book, chapterStart, verseStart, chapterEnd, verseEnd] = match
  assert.ok(bible[book], 'Missing WEBU book: ' + book)
  const c0 = Number(chapterStart)
  const v0 = Number(verseStart)
  const c1 = chapterEnd ? Number(chapterEnd) : c0
  const v1 = verseEnd ? Number(verseEnd) : v0
  const result = []
  for (let chapter = c0; chapter <= c1; chapter++) {
    for (const [verse, text] of bible[book][chapter] || []) {
      if (verse >= (chapter === c0 ? v0 : 1) && verse <= (chapter === c1 ? v1 : Infinity)) {
        assert.ok(text.trim(), 'Empty WEBU verse')
        result.push(book + ':' + chapter + ':' + verse)
      }
    }
  }
  assert.ok(result.length, 'No WEBU text for ' + reference)
  return result
}

test('Daily SOS provides 365 readings with exactly one primary passage each', () => {
  assert.equal(plan.length, 365)
  for (const [index, day] of plan.entries()) {
    assert.equal(day.length, 5, 'Day ' + (index + 1) + ' has malformed content')
    assert.ok(day[0] && day[1] && day[3] && day[4], 'Day ' + (index + 1) + ' has missing fields')
    assert.ok(['IDENTIFY', 'EQUIP', 'INVEST', 'ENTRUST'].includes(day[3]))
    primaryVerses(day[1])
  }
})

test('No repeated primary Scripture verses', () => {
  const seen = new Set()
  for (const day of plan) {
    for (const verse of primaryVerses(day[1])) {
      assert.ok(!seen.has(verse), 'Repeated primary passage verse ' + verse)
      seen.add(verse)
    }
  }
})

test('Acts follows the Gospels and covers every Acts chapter', () => {
  const gospelDays = plan.slice(0, 278)
  const actsDays = plan.slice(278)
  assert.equal(gospelDays.length, 278)
  assert.equal(actsDays.length, 87)
  assert.ok(gospelDays.every(day => /^(Matthew|Mark|Luke|John) /.test(day[1])))
  assert.ok(actsDays.every(day => day[1].startsWith('Acts ')))
  const coverage = new Set()
  for (const day of actsDays) {
    for (const ref of primaryVerses(day[1])) coverage.add(ref)
  }
  for (const [chapter, verses] of Object.entries(bible.Acts)) {
    for (const [verse] of verses) {
      assert.ok(coverage.has('Acts:' + chapter + ':' + verse), 'Missing Acts ' + chapter + ':' + verse)
    }
  }
})

test('The WEBU bundle includes all five required books', () => {
  for (const book of ['Matthew', 'Mark', 'Luke', 'John', 'Acts']) assert.ok(bible[book])
})
