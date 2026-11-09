"use client"

import { useState, useTransition } from "react"
import { castQuoteVote } from "../../award-actions"

const QUOTE_MAX_LENGTH = 500

export function QuoteVoteForm({ initialQuote, initialComment }: { initialQuote: string; initialComment: string }) {
  const [quote, setQuote] = useState(initialQuote)
  const [comment, setComment] = useState(initialComment)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(!!initialQuote)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!quote.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await castQuoteVote(quote, comment)
      if (result.success) {
        setSaved(true)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      <div>
        <label htmlFor="quote-text" className="block text-xs font-bold uppercase tracking-[0.12em] text-[#8892a0] mb-2">
          The quote
        </label>
        <textarea
          id="quote-text"
          value={quote}
          onChange={(e) => {
            setQuote(e.target.value)
            setSaved(false)
            setError(null)
          }}
          rows={3}
          maxLength={QUOTE_MAX_LENGTH}
          placeholder={'"Camp the flag" — someone, probably'}
          className="w-full rounded-lg border border-[#3d4855] bg-[#1f2833]/40 p-3 text-sm text-[#c5c6c7] placeholder:text-[#8892a0]/60 focus:outline-none focus:border-[#66fcf1] resize-none"
        />
        <p className="text-right text-xs text-[#8892a0] mt-1">
          {quote.length}/{QUOTE_MAX_LENGTH}
        </p>
      </div>

      <div>
        <label htmlFor="quote-comment" className="block text-xs font-bold uppercase tracking-[0.12em] text-[#8892a0] mb-2">
          Comment (optional)
        </label>
        <textarea
          id="quote-comment"
          value={comment}
          onChange={(e) => {
            setComment(e.target.value)
            setSaved(false)
          }}
          rows={3}
          placeholder="Who said it, when, or why it's your pick (optional)"
          className="w-full rounded-lg border border-[#3d4855] bg-[#1f2833]/40 p-3 text-sm text-[#c5c6c7] placeholder:text-[#8892a0]/60 focus:outline-none focus:border-[#66fcf1] resize-none"
        />
      </div>

      {error && <p className="text-sm text-[#ff4757] text-center">{error}</p>}

      <button
        type="button"
        disabled={!quote.trim() || isPending}
        onClick={handleSubmit}
        className="w-full rounded-lg bg-[#66fcf1] py-3 font-bold text-[#0b0c10] shadow-[0_0_18px_rgba(102,252,241,0.25)] transition hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {isPending ? "Saving…" : saved ? "Vote recorded — change anytime before voting closes" : "Submit vote"}
      </button>
    </div>
  )
}
