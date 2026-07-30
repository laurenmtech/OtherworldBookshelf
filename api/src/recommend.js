// Asking Claude for books.
//
// Two things here are load-bearing and shouldn't be "simplified":
//
//   1. EFFORT IS PINNED. Claude Opus 5 thinks by default and thinking tokens
//      bill as output, so an unpinned request costs several times a pinned one
//      — the difference between roughly $8 a month at the full allowance and
//      something nobody budgeted for. `effort: 'low'` is what makes the cost
//      estimate in the README true.
//
//   2. STRUCTURED OUTPUT IS THE CONTRACT. The response is constrained to a JSON
//      schema, so `suggestions` is always an array of {title, author, why}.
//      That removes the parsing failure mode entirely; it does NOT remove the
//      invented-book failure mode, which is what the caller's Open Library
//      verification pass is for.
import Anthropic from '@anthropic-ai/sdk'

// Both here, on purpose: swapping to Haiku is a two-line change if the bill
// ever surprises you. Haiku 4.5 costs roughly a fifth as much per ask and
// recommends noticeably less well — it is the cost lever, not the default.
export const MODEL = 'claude-opus-5'
export const EFFORT = 'low'

// A ceiling, not a target — unused tokens cost nothing. Generous because
// max_tokens caps thinking AND the answer together on this model, and a
// response truncated mid-JSON is a wasted call.
const MAX_TOKENS = 8000

const HOW_MANY = 5

// No minItems/maxItems: array-length constraints aren't part of the supported
// schema subset, so the count is asked for in the prompt and enforced by the
// caller trimming the list.
export const SUGGESTION_SCHEMA = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          author: { type: 'string' },
          why: { type: 'string' }
        },
        required: ['title', 'author', 'why'],
        additionalProperties: false
      }
    }
  },
  required: ['suggestions'],
  additionalProperties: false
}

const SYSTEM = `You recommend books to one reader, based on what they have read and how they said it felt.

Recommend exactly ${HOW_MANY} books.

Rules:
- Recommend only real, published books. If you are not confident a book exists with that exact title and author, do not include it. A shorter list of real books is far better than a longer one containing an invention.
- Never recommend anything in the reader's exclusion list. It contains what they own, have read, have set down, and have already passed on.
- "why" is one or two sentences addressed to this reader, referring to their actual taste — the books and moods they gave you. Not a blurb, not a plot summary, and not a description of the book's reputation.
- Vary the list. Do not recommend five books by one author or five volumes of one series.
- Moods the reader gives you are alternatives, never requirements to satisfy all at once.
- No preamble and no commentary outside the structured fields.`

// Everything the model is told about the reader. The full shelf never leaves
// the device: the caller sends a compressed summary and an exclusion list, and
// this is the only place either is used.
export function buildUserPrompt({ moods = [], freeText = '', tasteSummary = '', exclude = [] } = {}){
  const parts = []
  // Moods are alternatives, not requirements — the same rule the Finished
  // filters use, where picking two widens the results rather than narrowing to
  // books carrying both. Said explicitly because a bare list reads as a
  // conjunction: asked for cozy AND creepy AND epic, a model will go hunting
  // for the one book that is somehow all three, when what the reader wants is
  // a spread. Someone can genuinely be up for comfort fantasy or creepy horror
  // on the same evening, and both should turn up.
  if(moods.length){
    parts.push(
      `They are in the mood for ANY of these, not all at once: ${moods.join(', ')}.\n` +
      'Treat them as alternatives. A book that strongly fits one is far better ' +
      'than a book that vaguely fits several, and if they picked moods that pull ' +
      'in different directions, spread your recommendations across them rather ' +
      'than looking for something in the middle.'
    )
  }
  if(freeText) parts.push(`In their words: "${freeText}"`)
  if(tasteSummary) parts.push(`What they have loved before:\n${tasteSummary}`)
  if(exclude.length){
    parts.push(
      'Do NOT recommend any of these — they already have them, have read them, ' +
      'or have passed on them:\n' + exclude.map(t => `- ${t}`).join('\n')
    )
  }
  if(!moods.length && !freeText && !tasteSummary){
    parts.push('They have not said much about what they want. Offer a varied, well-regarded selection.')
  }
  return parts.join('\n\n')
}

// Returns { suggestions: [{title, author, why}] }. Throws on any upstream
// failure — the caller turns that into a typed error and refunds the credit.
export async function recommend(apiKey, request){
  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    output_config: {
      effort: EFFORT,
      format: { type: 'json_schema', schema: SUGGESTION_SCHEMA }
    },
    messages: [{ role: 'user', content: buildUserPrompt(request) }]
  })

  // Structured output guarantees the first text block is valid JSON matching
  // the schema — but a refusal or a token cutoff would leave us without one,
  // and those are the two cases worth naming rather than crashing on.
  if(message.stop_reason === 'refusal') throw new Error('refusal')
  const text = (message.content || []).find(b => b.type === 'text')
  if(!text) throw new Error(`no content (stop_reason: ${message.stop_reason})`)

  const parsed = JSON.parse(text.text)
  const suggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : []
  return { suggestions: suggestions.slice(0, HOW_MANY) }
}
