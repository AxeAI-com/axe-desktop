// The skills Axe ships with, in the open Agent Skills format: a folder named after the skill with a
// SKILL.md inside (front matter `name` and `description`, then plain instructions). Written for anyone,
// not just developers. Installing one writes this text to disk; nothing here runs code.

export type StarterSkill = { id: string; category: string; text: string }

const skill = (id: string, category: string, description: string, body: string): StarterSkill => ({
  id,
  category,
  text: `---\nname: ${id}\ndescription: ${description}\n---\n\n${body.trim()}\n`,
})

export const STARTER_SKILLS: StarterSkill[] = [
  skill(
    "brand-voice",
    "Writing",
    "Write or rewrite text in a calm, clear brand voice. Use when drafting copy, posts, emails or pages that should sound like the brand.",
    `
# Brand voice

Write the way a confident, friendly expert talks.

- Short sentences. One idea each.
- Plain words. Say "use", not "utilize"; "help", not "facilitate".
- Lead with what the reader gets, not what we did.
- No hype words (revolutionary, game-changing, unleash), no exclamation marks, no emoji unless asked.
- Never make up numbers, quotes or customers. Leave a [placeholder] instead.
- Sentence case for headings and buttons.

When asked to rewrite, keep the meaning and the facts. Give the new version first, then one line on what changed.
If the user has shared their own voice notes or examples, follow those over these rules.
`,
  ),
  skill(
    "deck-outline",
    "Work",
    "Outline a presentation slide by slide: a title, one message and what goes on each slide. Use for pitches, reviews and talks.",
    `
# Deck outline

1. Ask (or infer) who the audience is, what they should do afterwards, and how long the talk is. Assume 10 minutes if unsure.
2. Write the one sentence the whole deck proves.
3. Outline 8 to 12 slides. For each slide give:
   - **Title**: a full sentence that states the point ("Churn halves when teams use templates"), not a label ("Churn").
   - **On the slide**: the one visual or number that shows it.
   - **Say**: two lines of speaker notes.
4. Open with the problem or the goal, end with the ask.
5. Flag any number you would need to check with [check].

Keep slide text under 15 words. One message per slide.
`,
  ),
  skill(
    "contract-review",
    "Business",
    "Read a contract and list what to watch: payment, term, renewal, liability, IP, termination and anything unusual. Use when someone shares an agreement.",
    `
# Contract review

Start with one line: this is a plain-English read, not legal advice.

Then give:

1. **What it is**: who the parties are, what is being bought or sold, for how long.
2. **Money**: fees, when they are due, late fees, price changes.
3. **Term and renewal**: start, end, auto-renewal and the notice needed to stop it.
4. **Getting out**: how either side can end it and what it costs.
5. **Risk**: liability caps, indemnities, warranties, insurance.
6. **Your work and data**: who owns what is made, confidentiality, data use.
7. **Unusual or one-sided terms**: quote the clause number and say why it stands out.
8. **Questions to ask** before signing, at most five.

Quote clause numbers. If something is missing that most contracts of this kind have, say so.
`,
  ),
  skill(
    "meeting-notes",
    "Work",
    "Turn a meeting transcript or rough notes into a short summary, decisions and action items with owners. Use after calls and meetings.",
    `
# Meeting notes

From the transcript or notes, write:

## Summary
Three to five lines: what the meeting was for and where it landed.

## Decisions
A list. Only things that were actually agreed.

## Action items
A table with **Owner**, **Task** and **Due**. Use the names people used. If no owner or date was said, write "Unassigned" or "No date"; never guess.

## Open questions
What was raised and not settled.

Keep the speakers' meaning. Leave out small talk. If the transcript is unclear, say which part.
`,
  ),
  skill(
    "weekly-update",
    "Work",
    "Write a short weekly update for a team or stakeholders: what shipped, what's next, what's blocked. Use for status reports.",
    `
# Weekly update

Write it so a busy reader gets it in thirty seconds.

**This week**: three to five things that shipped or moved, each one line, with the result rather than the effort.
**Next week**: the top three priorities.
**Blocked**: anything waiting on someone, with who and what is needed. Write "Nothing blocked" when clear.
**Numbers**: only ones the user gave you.

No filler ("as you know", "just wanted to"). Link to details instead of pasting them.
`,
  ),
  skill(
    "launch-post",
    "Writing",
    "Draft a product launch post for X and LinkedIn from a short brief. Use when announcing a feature or release.",
    `
# Launch post

Ask for (or find in the chat) what launched, who it's for, and the link.

Write two drafts:

**X**: under 280 characters. First line is the outcome for the reader. One line on how. The link last. No hashtags unless asked.

**LinkedIn**: four to six short lines. Open with the problem people had, then what is now possible, then a call to try it.

Rules: no hype words, no emoji walls, no made-up numbers or quotes. Tag brands only when the user names their handles. These are drafts: never post anything.
`,
  ),
  skill(
    "email-reply",
    "Writing",
    "Reply to an email clearly and kindly, in the user's voice, answering every question asked. Use when someone pastes an email to answer.",
    `
# Email reply

1. List (to yourself) every question or request in the email.
2. Write a reply that answers each one, in the same order.
3. Match the sender's tone: formal stays formal, friendly stays friendly.
4. Keep it short. Most replies need under 120 words.
5. End with a clear next step or the answer they need, not "let me know if you have questions".

Give a subject line only if the reply starts a new thread. Never send it: show it as a draft.
`,
  ),
  skill(
    "research-brief",
    "Business",
    "Write a one-page brief on a company, market or topic with sources. Use when asked to look into something and sum it up.",
    `
# Research brief

Search when you can, and cite each fact with its source.

Structure:

1. **Bottom line**: two sentences anyone can act on.
2. **What matters**: three to five findings, each with why it matters to the user.
3. **Numbers**: only sourced ones, with the date they're from.
4. **What we don't know**: gaps and conflicting sources.
5. **Next steps**: what to check or decide.

One page. Prefer recent, primary sources. Say plainly when something is a guess.
`,
  ),
  skill(
    "code-review",
    "Code",
    "Review a change for bugs, unclear code and missing tests before it merges. Use on a diff, a branch or a pull request.",
    `
# Code review

Read the change and the code around it before judging.

Report, most important first:

1. **Bugs**: wrong behaviour with a concrete input that triggers it.
2. **Risks**: security, data loss, concurrency, error handling.
3. **Tests**: what isn't covered that should be.
4. **Clarity**: names, dead code, duplication. Keep these short.

For each finding give the file and line, what goes wrong, and a suggested fix. Say "Looks good" when there's nothing real; don't invent issues to seem thorough.
`,
  ),
  skill(
    "job-post",
    "Business",
    "Write a clear, fair job post from a few notes about the role. Use when hiring.",
    `
# Job post

From the notes, write:

- **The role in one line**: what this person will own.
- **What you'll do**: four to six bullets of real work, not traits.
- **What you'll bring**: must-haves only, at most five. Move nice-to-haves to their own short list.
- **How we work**: location, hours, team, pay range if given.
- **How to apply**: one step.

Use "you" and plain language. Avoid gendered words, "rockstar", "ninja" and long lists of years of experience.
`,
  ),
]
