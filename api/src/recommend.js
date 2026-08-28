// Asking Claude for books.
//
// Two things here are load-bearing and shouldn't be "simplified":
//
//   1. EFFORT IS PINNED — ON THE MODELS THAT TAKE IT. Claude Opus 5 thinks by
//      default and thinking tokens bill as output, so an unpinned request costs
//      several times a pinned one. `effort: 'low'` is what makes the cost table
//      in the README true. But Haiku 4.5 REJECTS `output_config.effort` with a
//      400 — it is not in the supported-models list — so sending the pin to the
//      cheap model would break the very swap the pin exists to make possible.
//      Hence EFFORT_MODELS below: the pin follows the model, not the file.
//
//   2. STRUCTURED OUTPUT IS THE CONTRACT. The response is constrained to a JSON
//      schema, so `suggestions` is always an array of {title, author, why}.
//      That removes the parsing failure mode entirely; it does NOT remove the
//      invented-book failure mode, which is what the caller's Open Library
//      verification pass is for.
import Anthropic from '@anthropic-ai/sdk'

// The DEFAULT model, overridden by MODEL in wrangler.toml — so the Haiku swap
// is a config change and a deploy rather than an edit to this file. Haiku 4.5
// costs roughly a fifth as much per ask and recommends noticeably less well: it
// is the cost lever, not the default.
export const MODEL = 'claude-opus-5'
export const EFFORT = 'low'

// Models that accept `output_config.effort`. Anything not listed gets the
// request WITHOUT the pin, because sending it is a 400, not a no-op. Listed
// rather than inferred from the id: a name-shaped guess ("opus means yes") is
// how the next model quietly breaks this route.
export const EFFORT_MODELS = new Set([
  'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
  'claude-sonnet-5', 'claude-sonnet-4-6', 'claude-fable-5'
])

export const takesEffort = (model) => EFFORT_MODELS.has(model)

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

// Everything the model is told about the reader — the compressed summary and
// the exclusion list, and nothing else.
export function buildUserPrompt({ moods = [], freeText = '', tasteSummary = '', exclude = [] } = {}){
  const parts = []
  // The alternatives rule is spelled out at length because a bare list reads as
  // a conjunction: asked for cozy AND creepy AND epic, a model goes hunting for
  // the one book that is somehow all three. Someone can be up for comfort
  // fantasy or creepy horror on the same evening, and both should turn up.
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

// Returns { suggestions: [{title, author, why}], usage, model }. `usage` is
// what the month's ledger is billed from — the caller prices it. Throws on any
// upstream failure, which the caller turns into a typed error and a refund.
export async function recommend(apiKey, request, model = MODEL){
  const client = new Anthropic({ apiKey })
  const message = await client.messages.create({
    model,
    max_tokens: MAX_TOKENS,
    system: SYSTEM,
    output_config: {
      ...(takesEffort(model) ? { effort: EFFORT } : {}),
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
  return { suggestions: suggestions.slice(0, HOW_MANY), usage: message.usage || {}, model }
}
