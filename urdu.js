// Urdu-only page adaptations. All Scripture is published OUCV, never an AI
// translation. This module is loaded before i18n:ready so moved accordion
// elements already contain Urdu when the study UI builds itself.
let biblePromise
export function loadBible() {
    if (!biblePromise) biblePromise = fetch('/assets/bible/ur-oucv.json').then(res => {
        if (!res.ok) throw new Error('Urdu Bible unavailable')
        return res.json()
    }).catch(error => { biblePromise = null; throw error })
    return biblePromise
}
export function parseReference(ref) {
    const match = /^([A-Z]{3}) (\d+):(\d+)(?:[-–](\d+))?$/.exec(ref)
    if (!match) throw new Error('Invalid Bible reference')
    const [, book, chapter, first, last] = match
    if (+first < 1 || +(last || first) < +first) throw new Error('Invalid verse range')
    return { book: book.toLowerCase(), chapter, first: +first, last: +(last || first) }
}
export function passage(data, reference) {
    const ref = parseReference(reference)
    const book = data.books[ref.book]
    const chapter = book?.chapters[ref.chapter]
    if (!chapter) throw new Error('Passage unavailable')
    const verses = []
    for (let n = ref.first; n <= ref.last; n++) {
        const value = chapter[n]
        // Some critical-text editions represent omitted verses as notes only.
        // Keep their supplied notes and never manufacture missing Scripture.
        if (!value) throw new Error(`Missing source verse ${reference}:${n}`)
        verses.push({ number: n, ...value })
    }
    return { title: `${book.name} ${ref.chapter}:${ref.first}${ref.last === ref.first ? '' : '–' + ref.last}`, verses }
}
export function attribution() {
    const p = document.createElement('details')
    p.className = 'bible-attribution'
    p.lang = 'en'
    p.dir = 'ltr'
    // Copyright text is kept in its published form. This English notice is
    // intentional attribution, not an untranslated part of the interface.
    p.innerHTML = '<summary>OUCV · © Biblica · CC BY-SA 4.0</summary><div>' +
        'Biblica® آزادانہ اردو ہم عصر ترجمہ™<br>' +
        'Biblica® Open Urdu Contemporary Version™<br>' +
        'Copyright © 1999, 2005, 2022, 2024 by Biblica, Inc.<br>' +
        '“Biblica” is a trademark registered in the United States Patent and Trademark Office by Biblica, Inc. Used with permission.<br>' +
        'The original Work by its copyright holders is available for free at ' +
        '<a href="https://www.biblica.com/">www.biblica.com</a> and <a href="https://open.bible/">open.bible</a>. ' +
        'Scripture text and this extracted Scripture dataset: <a href="https://creativecommons.org/licenses/by-sa/4.0/" rel="license">CC BY-SA 4.0</a>. ' +
        '<a href="/bible-copyright.html?lang=ur">حقوق اور ماخذ</a>.</div>'
    return p
}
export function renderPassage(container, data, reference) {
    const result = passage(data, reference)
    const title = window.i18n.reference(result.title)
    const verses = result.verses
    container.replaceChildren()
    container.lang = 'ur'
    container.dir = 'rtl'
    const heading = document.createElement('div')
    heading.className = 'bible-translation'
    heading.textContent = `${title} · Biblica® آزادانہ اردو ہم عصر ترجمہ™ (OUCV)`
    container.append(heading)
    for (const verse of verses) {
        const p = document.createElement('p')
        p.className = 'bible-verse'
        const num = document.createElement('span')
        num.className = 'verse-num'
        num.textContent = verse.number
        p.append(num, document.createTextNode(verse.text))
        container.append(p)
        if (verse.notes.length) {
            const details = document.createElement('details')
            details.className = 'bible-notes'
            const summary = document.createElement('summary')
            summary.textContent = 'حاشیہ'
            details.append(summary)
            for (const note of verse.notes) {
                const text = document.createElement('p')
                text.textContent = note
                details.append(text)
            }
            container.append(details)
        }
    }
    container.append(attribution())
    return title
}
function printableGuide() {
    const image = document.querySelector('.hero-image')
    if (!image || !location.pathname.includes('conversation-box-guide')) return
    document.documentElement.classList.add('urdu-guide-page')
    image.hidden = true
    image.style.display = 'none'
    const guide = document.createElement('article')
    guide.className = 'urdu-print-guide'
    guide.id = 'urdu-guide'
    guide.innerHTML = '<h1>گفتگو کا خانہ</h1><p>عام گفتگو سے کلام کی دریافت تک</p>' +
        '<ol><li><b>عام گفتگو</b><p>سلام کریں، حال پوچھیں اور دلچسپی سے سنیں۔</p></li>' +
        '<li><b>بامقصد گفتگو</b><p>خوشیوں، مشکلات، خاندان اور زندگی کے بارے میں بات کریں۔</p></li>' +
        '<li><b>روحانی گفتگو</b><p>پوچھیں: کیا میں اس بات کے لیے دعا کر سکتا ہوں؟ خدا نے آپ کی زندگی میں کیا کیا ہے؟ یسوع کی خوش خبری سنائیں۔</p></li>' +
        '<li><b>کلام کی دریافت</b><p>پوچھیں: کیا آپ مل کر یسوع کی ایک کہانی پڑھنا چاہیں گے؟ پھر مل کر پڑھیں، سمجھیں، عمل کریں اور دوسروں کو سنائیں۔</p></li></ol>' +
        '<p>لوگوں کے نام کی جگہ ابتدائی حروف یا عرف لکھیں۔ ان کے لیے دعا کریں اور اگلی گفتگو کا قدم طے کریں۔</p><p dir="ltr">OBEY.TOOLS</p>'
    image.after(guide)
    const download = document.querySelector('a[download]')
    if (download) {
        download.href = '#urdu-guide'
        download.removeAttribute('download')
        download.removeAttribute('data-i18n')
        download.textContent = '↓ اردو رہنمائی پرنٹ یا پی ڈی ایف میں محفوظ کریں'
        download.addEventListener('click', event => { event.preventDefault(); window.print() })
    }
    const note = document.querySelector('.hero .small-note')
    if (note) { note.removeAttribute('data-i18n'); note.textContent = 'مفت اردو رہنمائی۔ پرنٹ کریں یا پی ڈی ایف میں محفوظ کریں۔' }
}
export async function localizeUrduPage() {
    const video = document.querySelector('iframe[src*="youtube.com/embed/5W8ynRMr59k"]')
    if (video) video.src = 'https://www.youtube.com/embed/4W-Wfs7x0lk'
    printableGuide()
    const containers = [...document.querySelectorAll('[data-bible-ref]')]
    if (containers.length) {
        try {
            const data = await loadBible()
            for (const container of containers) {
                const title = renderPassage(container, data, container.dataset.bibleRef)
                const card = container.closest('.card')
                for (const button of (card || document).querySelectorAll('.bible-btn > span:first-child')) {
                    button.removeAttribute('data-i18n')
                    button.textContent = `${title} (OUCV)`
                }
            }
        } catch (error) {
            console.error(error)
            for (const container of containers) {
                container.replaceChildren()
                const notice = document.createElement('p')
                notice.textContent = 'اردو عبارت لوڈ نہیں ہو سکی۔ دوبارہ کوشش کریں یا مکمل عبارت کھولیں۔'
                const link = document.createElement('a')
                link.href = '/scripture.html?lang=ur&ref=' + encodeURIComponent(container.dataset.bibleRef)
                link.textContent = 'عبارت کھولیں'
                container.append(notice, link)
            }
        }
    }
    if (location.pathname.includes('church-assessment')) {
        for (const id of ['presentation-view','landing-view']) document.getElementById(id)?.append(attribution())
    }
}
