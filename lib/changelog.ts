/**
 * Maily public changelog — the ship log rendered at /changelog.
 *
 * HOW TO ADD AN ENTRY: prepend to the group for today's date (create the
 * group if it doesn't exist — newest group first). Write for FOUNDERS, not
 * developers: what changed in their product, in plain language. No internal
 * jargon, no commit-speak, no file names.
 *
 * Tags: 'New' = a capability that didn't exist · 'Improved' = an existing
 * thing got meaningfully better · 'Fixed' = something broken now works.
 */

export type ChangelogTag = 'New' | 'Improved' | 'Fixed';

export interface ChangelogEntry {
  tag: ChangelogTag;
  title: string;
  points: string[];
}

export interface ChangelogGroup {
  /** Human date, e.g. "July 11, 2026" */
  date: string;
  entries: ChangelogEntry[];
}

export const CHANGELOG: ChangelogGroup[] = [
  {
    date: 'July 26, 2026',
    entries: [
      {
        tag: 'Improved',
        title: 'A cleaner, lighter home — and a one-tap refresh',
        points: [
          'The Today home feed has a new look: a calm, light, monochrome design — white cards on a soft canvas with crisp hairline borders, in the spirit of tools like Linear and Vercel. Less visual noise, easier to scan, with a single red kept only for what’s genuinely at risk or errored.',
          'New refresh button at the top of the feed re-pulls everything at once — today’s snapshot, your world, and your weekly analytics — so you can force a fresh read whenever you want, in one tap.',
        ],
      },
    ],
  },
  {
    date: 'July 25, 2026',
    entries: [
      {
        tag: 'Improved',
        title: '“Sift says…” now reads your whole table back to you',
        points: [
          'The morning “Sift says…” line is no longer a clipped one-liner. It gives a full short paragraph — who’s waiting on a reply, what’s gone quiet or is at risk, the meetings and promises coming up, and what’s already handled — ending on the single move that matters most today.',
          'It no longer cuts off mid-sentence (an internal length limit was trimming it early), and it now always appears when Sift has something real to say — even on a day with no separate recommendations.',
        ],
      },
      {
        tag: 'Improved',
        title: '“Handle it” now does it — in one click',
        points: [
          'Clicking “Handle it” on any card no longer bounces you to a new page with a prompt you still have to send. It opens Boult right where you are and sends the request instantly — one click, and it’s already working.',
        ],
      },
      {
        tag: 'New',
        title: 'See — and connect — your whole stack, right from home',
        points: [
          'A new “Your stack” strip shows every app that feeds your world — Gmail, Calendar, Meet, Notion, Slack, Cal.com — with the connected ones lit up and the rest one tap away. Connect more and your relationship cards start fusing those people’s meetings, docs, and messages automatically.',
          'Newsletters, marketing blasts, and shop or order notifications no longer masquerade as relationships — they’re filtered out before they ever reach a card, so “your world” is only real people.',
          'A cleaner, calmer, more premium home: frosted-glass cards, a soft textured backdrop behind the greeting, and lighter, more Apple-like spacing — less boxy, easier to scan.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Your world cards now read the actual conversation — not just the subject line',
        points: [
          'Each relationship card now understands what was really said. It pulls the real ask, promise, or number out of the latest message and shows it to you in quotes — so instead of “quiet 8 days,” you see the actual line: “can you send the signed SOW by Friday?”',
          'Cards now tell you what a relationship is when the thread makes it clear — Investor, Customer, Lead, Candidate, Vendor, or Press — so you can read the room at a glance.',
          'The “why this needs you now” line is sharper: it names the specific thing at stake from the real message, never a generic “follow up.” When a card can’t be certain, it stays quiet rather than guess.',
        ],
      },
      {
        tag: 'New',
        title: 'A home that shows YOUR world — across every app, not just email',
        points: [
          'The home feed no longer opens with what Maily did for you. It opens with where your world stands: who’s waiting on you, what’s coming up, and what you owe — the state of your day, not a scoreboard of the software.',
          'New “What’s slipping” — the things genuinely at risk right now, ranked by what it costs to miss: a deal gone quiet, a VIP you haven’t answered, a bounced email — pulled from across your apps, so you see a loss before it happens.',
          'New “Your world right now” — each important relationship shown as a living thing across every connected app at once: an email thread’s status fused with that same person’s calendar, Cal.com booking, Notion page, and Slack DM. One glance tells you everything, one click hands it to Boult.',
          'It only ever joins signals it’s certain about (an exact email or exact name match), and a disconnected app simply never appears — nothing invented.',
          'New “On your plate” — the commitments you made in meetings, with their due dates, so a promise never quietly slips. And “Your meetings” now reads your day back to you: how much of it is booked and whether it’s stacked back-to-back.',
          'The weekly agent-activity view didn’t go away — it’s now a single quiet “Handled quietly” line at the very bottom you can expand any time.',
        ],
      },
    ],
  },
  {
    date: 'July 23, 2026',
    entries: [
      {
        tag: 'Improved',
        title: 'A cleaner, more useful “Your week”',
        points: [
          'Redesigned the “Your week” panel with frosted glass cards and textured stat pills — a calmer, more premium read of what Boult did for you.',
          'It tells you more at a glance: four headline numbers (actions, runs, daily average, and your busiest day), the daily trend with your busiest day highlighted, and a new “This week, in short” — your busiest day, how many of the 7 days had activity, and your average actions per run.',
          'Dropped a duplicate chart that just re-plotted the same daily numbers, so the panel is less cluttered and every tile now earns its place. Every number is still real — nothing illustrative.',
        ],
      },
      {
        tag: 'Improved',
        title: 'The home feed now tells you when the AI actually fails',
        points: [
          'Instead of quietly swapping in a generic stand-in when an AI step can’t run, the feed now shows the real reason right where that content would be — e.g. “AI error — models rate-limited” — with a Retry.',
          'This applies across the feed: the “Sift says…” line, the “Worth your time” suggestions, the cross-app analytics, and the reasons under “Needs a reply.” No more plausible-looking filler hiding a failure.',
        ],
      },
      {
        tag: 'Fixed',
        title: '“Sift says…” now gives you a real read, even on a quiet day',
        points: [
          'The one-line summary at the top of your feed was falling back to a generic “Here’s what deserves your attention today,” even though the AI had actually written a specific read — the page just wasn’t showing it.',
          'It now shows the AI’s real line: what needs you when there’s something, and a clear “all quiet — nothing needs you” when your inbox and calendar are genuinely handled. It no longer depends on a separate step that could be rate-limited.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Reconnecting Google now actually works — and clears the warning',
        points: [
          'Every Google connection — Gmail, Calendar, and Meet — now reconnects through our verified sign-in, instead of the old flow that kept looping back to the same error. Calendar in particular was still using the old path; it now matches the rest.',
          'The banner now names the connection that actually expired (Gmail or Calendar) and reconnects that one — it no longer tries to reconnect Gmail when it was really Calendar that lapsed.',
          'Once you reconnect, the warning clears right away. Before, the banner could linger even after a successful reconnect because the page was still showing a cached copy from when the connection was down.',
          'Fixed the deeper reason Calendar kept showing as expired: it was reading your calendar over the old connection style while Gmail had moved to the new verified one, so it failed every time. Calendar now loads over the same verified connection — so an already-connected calendar just works, no reconnect needed.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'The home feed’s AI briefings are specific again — and much faster',
        points: [
          'The reasons under “Needs a reply”, the “Key conversations” summaries, and the “Sift says…” read could quietly fall back to plain, generic text — so the feed sometimes looked like a fixed template instead of something that had actually read your inbox.',
          'The real cause: building the fresh, AI-written version was taking so long it occasionally timed out, and you were left looking at an older, generic copy. Building it is now several times faster, so the specific version reliably lands — and your daily one-line briefing is back.',
        ],
      },
    ],
  },
  {
    date: 'July 22, 2026',
    entries: [
      {
        tag: 'New',
        title: 'A redesigned home feed that shows where your world stands',
        points: [
          'The home feed used to be a log of what already happened. It now opens with a real command center: a one-line read on your day, four live numbers (need a reply, meetings, awaiting reply, handled for you), and a chart of what Boult actually did across the last 7 days.',
          'New "Key conversations" section — your important threads and exactly where each one stands right now: awaiting your reply, waiting on them, or a meeting is booked. One click hands any of them to Boult to handle.',
          'The things that need you are separated from the things that are handled: reply-now emails, your upcoming meetings with one-tap prep and scheduling, cross-app suggestions from Gmail, Calendar, Notion and Slack, and a recap of what your agents did while you were away.',
          'Every number on the page is real — the week chart shows an honest empty state when there is no activity yet, never a fake trend.',
        ],
      },
    ],
  },
  {
    date: 'July 20, 2026',
    entries: [
      {
        tag: 'Improved',
        title: 'The security page, rebuilt — and far more thorough',
        points: [
          'The security page now matches the rest of the site — the same cards, headings and motion — instead of looking like a page from a different product.',
          'It now spells out the exact three Google permissions Maily asks for, and why each one is there — the same list the Google consent screen shows you.',
          'Added a plain-English security FAQ: what the AI can read, what it can access, whether data is ever sold, what happens when you delete your account, who else touches your data, and the fact that nothing sends without your approval.',
          'Added links to the deeper reading — the zero-knowledge encryption write-up, the Privacy Policy, the Terms, and the one-click page to revoke Google access.',
          'Fixed a set of text colours across the site that were silently not applying, including a few labels and ticks that were meant to stand out and were rendering as plain grey.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Boult now edits documents instead of rewriting them from a guess',
        points: [
          'Asking Boult to change something in an open document — shorten it, add a section, fix a line — used to produce a much shorter, generic replacement, because Boult was working from a vague memory of the topic rather than the actual text on your screen.',
          'Boult now sees the exact live document before editing it, so changes land on the real content and everything you did not ask to change stays intact.',
          'New documents are also held to a higher bar: real sections and real depth for anything you call a report, doc, or plan — not a two-line stub.',
        ],
      },
      {
        tag: 'New',
        title: 'A weekly plan, for trying Maily properly',
        points: [
          '$8.99 a week gets you the complete product — every feature, nothing held back. It renews weekly and you can cancel anytime from your billing portal.',
          'It sits alongside Monthly, Annual and Lifetime on the pricing page and in setup.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Plans now end exactly when they should',
        points: [
          'Annual plans could be recorded as ending after one month instead of one year, depending on which confirmation our payment provider sent first.',
          'Your plan name is now shown correctly on your profile — annual subscribers were being labelled "Free Plan".',
        ],
      },
    ],
  },
  {
    date: 'July 19, 2026',
    entries: [
      {
        tag: 'New',
        title: 'Documents are properly editable now',
        points: [
          'The document panel has a real editor: headings, bold, italic, strikethrough, code, bullet and numbered lists, quotes and dividers, with undo and redo.',
          'Editing used to mean typing raw markdown — hash marks and asterisks — into a plain monospace box, with no way to see the document until you stopped.',
          'Pasting formatted text now keeps its formatting instead of arriving as literal asterisks.',
        ],
      },
      {
        tag: 'Improved',
        title: 'The document panel reads like a document',
        points: [
          'Headings are bigger, the body text is larger and higher contrast, and the lines that used to sit under every heading are gone — it looked like a filled-in form.',
          'The header now shows the file size beside the title, and Download is a single button with the format choice inside it instead of three look-alike icons.',
          'Documents can be expanded to a wider reading width.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Boult shows less clutter while it works',
        points: [
          'When Boult reads seven emails in a row it now says so once, as a single line with a count, instead of seven identical rows you had to scroll past to reach the answer.',
        ],
      },
      {
        tag: 'New',
        title: 'Watch Boult actually work',
        points: [
          'The Meet Boult section now shows a real recording of Boult running — triaging, drafting and booking — in place of the example readout that used to sit there.',
        ],
      },
      {
        tag: 'New',
        title: 'See the Gmail connection before you sign up',
        points: [
          'The homepage now shows a real recording of connecting a Gmail account — the whole thing, start to finish, so you can see how little there is to it before you commit.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Less reading below the fold, more watching',
        points: [
          'The product demos are bigger and the text beside them is down to a line each — the recordings make the point better than a paragraph competing with them for attention.',
          'The morning before-and-after is now a single stark number instead of two dense panels of example emails.',
          'Text reveals word by word as it scrolls into view.',
        ],
      },
      {
        tag: 'Improved',
        title: 'A lighter homepage that moves as you scroll',
        points: [
          'The top navigation is now three separate floating pieces — the logo, the links, and the two buttons — instead of one long bar stretched across the screen.',
          'Text and cards fade in as they come into view, in both scroll directions, so the page feels alive rather than static.',
          'The "Why Maily" and "Meet Boult" sections were paragraphs of solid prose. They are now a few short lines you can take in at a glance — the argument is the same, the reading is not.',
          'The morning payoff figures are now proper cards with icons instead of loose text.',
          'The quick-access bar is back at the bottom of the homepage.',
        ],
      },
    ],
  },
  {
    date: 'July 18, 2026',
    entries: [
      {
        tag: 'New',
        title: 'Give a friend a free month — and get one back',
        points: [
          'Anyone you invite now gets a full free month of Maily instead of the 3-day trial. When they stay on as a customer, a free month is added to your account automatically — nothing to claim.',
          'Open Rewards in the sidebar for your link, then "Open share screen" for the full version: a pre-written message and one tap to WhatsApp, email, X or LinkedIn. On a phone it opens your normal share sheet.',
          'You can see how many friends have joined and how many months you have earned.',
          'Previously invites paid out in credits, which nothing in the product could spend — so the reward was worth nothing. It is real subscription time now.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Cards and buttons have real depth now',
        points: [
          'Cards catch the light along their top edge and fade into the page, so they read as surfaces rather than flat outlines.',
          'The three setup steps are now proper cards with lit icon tiles, and they lift as your cursor passes over them.',
          'Section labels are genuinely translucent where there is something glowing behind them to pick up.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Every section of the site now looks like it belongs to the same site',
        points: [
          'Each section used to introduce itself differently — four label styles, three alignments, and two sections with no heading at all. They now share one header: a small labelled pill, the heading, and a single line underneath.',
          'The demo switcher and the integrations map finally have headings, so you know what you are looking at before you look at it.',
          'Every card on the page — pain points, statements, the before/after panels, the pricing tiers — now uses the same fill, corner radius and edge treatment.',
          'Pricing has moved to a centred layout that matches the rest of the site, on both the homepage and the pricing page.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'The homepage no longer implies customers we do not have',
        points: [
          'A scrolling row of company names sat near the top of the homepage in a "trusted by" position. Those companies were placeholder text from the design component, not customers, and the row has been removed.',
          'Numbers that were only ever illustrative — the morning time-savings figures and the sample inbox sweep — now say so on screen instead of reading like measured results.',
          'Two cards styled as customer quotes are now plainly labelled as product claims, because we have no customer quotes yet.',
        ],
      },
      {
        tag: 'Improved',
        title: 'A faster, clearer homepage',
        points: [
          'What Maily actually does now comes before the price instead of after it, and the opening argument is a quarter of its old length.',
          'Buttons that went nowhere now work: "Put work on autopilot" reaches pricing, and "Watch Maily handle a real inbox" reaches the demos.',
          'Headings follow one consistent size scale, so the page no longer shouts louder at the bottom than at the top.',
          'The floating bottom toolbar is gone from the homepage, giving the page back the screen space it was covering.',
          'The FAQ and the demo switcher can now be operated by keyboard and read by screen readers.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Maily is open — no more access requests',
        points: [
          'You no longer have to request access and wait for approval. Every "Get started" button takes you straight to signup, and you are in.',
          'The old access-request form and its approval queue are gone entirely.',
        ],
      },
    ],
  },
  {
    date: 'July 17, 2026',
    entries: [
      {
        tag: 'Improved',
        title: 'One-step Google sign-in and connect',
        points: [
          'Signing up now signs you in and connects your Gmail in a single Google approval, through a verified provider — no separate login-then-connect, and no signup ceiling.',
          'You go from the homepage straight into onboarding with Gmail already connected, ready to work.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Connecting Google is smoother and ready to scale',
        points: [
          'Signing in now asks only for your name and email; Gmail access is a separate, clearly-scoped step — so the permission screen is smaller and easier to trust.',
          'Getting started from the homepage now drops you straight onto the Gmail-connect step right after sign-in, so setup feels like one continuous action instead of extra clicks.',
          'Connection problems finally speak up: if a Google connect is cancelled or doesn\'t finish, you get a clear message instead of a silent bounce-back.',
          'If a Google connection ever expires, the app now knows the moment it happens and shows you a clear "reconnect" prompt — instead of quietly failing the next time Boult tries to act.',
          'Behind the scenes, the Google connection can now run through a verified provider, which removes the old signup ceiling — the app is ready to onboard far more people without hitting a wall.',
        ],
      },
      {
        tag: 'New',
        title: 'Big tasks never get cut off anymore',
        points: [
          'Boult now gets a 5-minute working window per pass (up from ~1 minute) — and when a task genuinely needs more, it automatically continues in a fresh pass, carrying over everything it already did. No more "the response got cut off before the summary came back."',
          'You see it happen naturally in the chat: the first pass shows its steps and says it\'s continuing, the next pass picks up exactly where it stopped and delivers the complete answer. Small tasks are exactly as fast as before.',
          'Scheduled agents get the same 5-minute window, so deep inbox sweeps can actually finish and deliver their reports.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Scheduled agents finish their runs again',
        points: [
          'Daily agents had been dying mid-run for days with "cut short by the serverless time limit" — every morning, the same error. Root cause found: on slow AI-provider days, one stalled model could quietly eat several times its time budget, so the run got killed before it could finish and deliver.',
          'Every AI call inside a scheduled run is now hard-capped by the actual time remaining, so runs wrap up cleanly — they do the work that fits, write the report, and deliver it, instead of dying silently.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Plan documents look like real strategy docs now',
        points: [
          'Asking Boult to plan something big used to produce a thin page whose Steps section could show raw code instead of steps. Fixed at every layer: steps now render as numbered rows with descriptions, timelines and success metrics lay out as proper tables, and even a malformed plan gets repaired into readable steps instead of showing JSON.',
          'Plans are also held to a much higher bar: objective, where things stand, 6–12 concrete steps, timeline, measurable success metrics, risks with mitigations, and the expected output — grounded in what you actually said, never invented numbers.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'FAQ answers show up again',
        points: [
          'Opening a question on the homepage FAQ could leave the answer area blank — the words were there, just stuck invisible mid-reveal. Answers now always appear the moment a question opens.',
        ],
      },
    ],
  },
  {
    date: 'July 16, 2026',
    entries: [
      {
        tag: 'Fixed',
        title: 'The website finally behaves on your phone',
        points: [
          'The homepage on mobile had real problems: the partner-logo strip was a blurry smear, the product demo clips were cropped down to an unreadable sliver, and sections floated in long stretches of empty black. All fixed — logos focus as they pass the center of your screen, demo videos show the full frame, and the page flows section to section without the dead space.',
          'Also fixed a hidden bug that made every visit load the page twice — the site now paints once, faster, on every device.',
          'And the headline says what we mean: "You run your company, We run your inbox."',
        ],
      },
      {
        tag: 'Improved',
        title: 'The website is dramatically faster and smoother',
        points: [
          'Several readers told us the homepage stuttered while scrolling — they were right. Under the hood, half a dozen background effects kept re-rendering the entire page many times per second, even for parts of the page you weren\'t looking at.',
          'Every animation now runs only while it\'s actually on your screen, videos pause themselves when you scroll past them, and section reveals play once instead of replaying on every scroll. Scrolling should feel smooth now, and the page uses far less battery on laptops and phones.',
          'Nothing visual was removed — same design, same motion, a fraction of the work.',
        ],
      },
      {
        tag: 'Improved',
        title: 'The home feed goes liquid glass',
        points: [
          'Your daily briefing now wears the new liquid-glass look — cards, the Today/Inbox switcher, and the refresh control are real glass: light bends at their edges and the feed refracts through them as you scroll.',
          'The tab switcher floats over the feed instead of sitting on a solid bar, and the sidebar is frosted so the page reads as one continuous surface.',
          'Works in light and dark, and respects reduced-motion settings.',
        ],
      },
      {
        tag: 'New',
        title: 'Edit and re-send your messages — and flip between answers',
        points: [
          'Every message you send now has an Edit button. Change the wording and send — Boult answers the new version, and you can slide between the old and new answers with the ‹ › arrows, just like the big AI chats.',
          'A Copy button sits right under each message.',
          'Long messages collapse to a few lines with a "Show more" toggle, so a big paste doesn\'t take over the screen — tap to expand, tap again for "Show less".',
        ],
      },
      {
        tag: 'Fixed',
        title: 'The home-screen Refresh button now shows it\'s working',
        points: [
          'Tapping "Refresh" on your daily briefing kicks off a fresh read of your inbox and calendar — but it used to give no sign it had started, so it looked like nothing happened. Now the button spins and reads "Refreshing…" the moment you tap it, then settles back to "just now" when the new briefing lands.',
          'Your current briefing stays on screen the whole time — the refresh happens quietly in the background instead of blanking the page.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Outreach now writes the actual emails, cleanly',
        points: [
          'Outreach could get stuck researching and then hand back a written-out "here\'s my approach for each person" summary instead of real, send-ready emails. Fixed — it now writes the finished emails for everyone, shows them in a tracker, samples a few in chat, and takes your one approval before anything goes out.',
          'The pitch now comes from what you actually told it, personalized per person, instead of a generic stand-in line.',
          'Cleaned up a stream of internal progress chatter ("creating 5 searches now, 4 of 5 done…") that was leaking into the conversation. You\'ll only see meaningful progress now, like drafts being written.',
        ],
      },
      {
        tag: 'New',
        title: 'Meet the outreach capability — right from the chat',
        points: [
          'A "New" pill on the Boult home screen introduces cold outreach. Tap it for a short animated walkthrough of the whole flow — intake, research, drafting, your approval, and the paced send — then one tap on "Start outreach".',
          'Starting now drops you straight into the flow: Boult immediately asks for your list and your pitch, in a fast, friendly reply. (The earlier version could stall here; that\'s fixed — it answers in a second and never times out.)',
          'There\'s no new tab or setup to hunt for. Outreach lives inside the same chat and agents you already use. Seen it already? Dismiss the pill and it won\'t come back.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Drafting replies to several emails no longer times out',
        points: [
          'Asking Boult to "draft replies to the 5 emails waiting on me" used to grind past the time limit and come back with an apology and nothing to show. Now it reads all the threads together, writes every reply in one pass, and shows them instantly.',
          'Each reply lands as its own card in the chat: recipient, subject, and a voice-match score. Click one to open it, tweak the wording, and send. Five emails means five cards you can work through in seconds.',
          'Send goes straight to the recipient in the right thread, not just to your Drafts folder. Anything you don\'t send stays saved as a draft.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Outreach that finds your leads, sounds human, and shows its work',
        points: [
          'Point Boult at your contacts wherever they live: attach a CSV, paste a list, or just say "email everyone in my Leads database in Notion" and it reads the real rows itself. If it can\'t find valid addresses, it tells you exactly where it looked instead of guessing.',
          'Every email now reads like a real person typed it: no em-dashes, no "I hope this email finds you well", no AI throat-clearing. Plain, direct, in your voice.',
          'Before it asks for your approval, Boult opens a live tracker you can watch: every lead with its research hook, status, and send time, updating as the batch moves from drafted to queued to sent.',
          'One request does the whole job. Boult plans and executes in the same turn: pulls the leads, researches each person, drafts, opens the tracker, asks once, and schedules the send. Ask for a watcher and it deploys a background agent that keeps working at a safe ~40 emails a day.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Cal.com connects cleanly',
        points: [
          'Connecting Cal.com from the integrations panel used to bounce you to a broken Cal.com login page. Cal.com now connects the right way — paste your API key inline and you\'re done, no dead-end redirect.',
        ],
      },
    ],
  },
  {
    date: 'July 14, 2026',
    entries: [
      {
        tag: 'Improved',
        title: 'A cleaner live view while Boult works',
        points: [
          'One thinking indicator, one place — the live "thinking" shimmer no longer shows up twice, and execution steps live only inside the collapsible steps box on the reply.',
          'The steps box now starts closed and quietly shows what\'s running in its header; it opens itself only when a real multi-step task is underway, in a fixed-width, pure black-and-white design.',
          'Thoughts now sit under the executor box as a quiet trace instead of reading like the reply itself, and the blinking bar that could get stuck under a reply is gone.',
          'Stray model artifacts (a lone "False" line) no longer leak into the chat.',
          'When Boult asks a clarifying question, it now suggests the most likely answers as tappable choices — its best guess comes preselected, so one tap answers it. Your reply lands in the chat as a clean answer, not a form transcript.',
          'A question from Boult now reads like a normal message in the conversation — no more empty reply above the question card.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Chat stays put, one loader, no email dumps',
        points: [
          'Sending a follow-up message no longer risks bouncing you back to the start screen mid-reply (the bug that forced a refresh and burned a second run).',
          'The thinking indicator is truly singular now — the placeholder "Thinking..." line that doubled it is gone; only real reasoning shows under the header.',
          'While drafting or triaging, Boult references an email in a line or two instead of pasting the whole thing — full bodies only when you ask to see them.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Replies are fast again',
        points: [
          'A model-provider quirk was silently eating the response budget on "thinking", which made normal replies crawl to ~50 seconds and sometimes come back blank. Boult now tells that model family to answer directly — replies land in seconds again.',
          'When a model is having a bad day, Boult now steps around it once instead of re-trying the same failure on every backup key.',
        ],
      },
      {
        tag: 'New',
        title: 'Boult can decide to plan before it acts',
        points: [
          'When a request mid-conversation turns out to be big, multi-phase, or risky, Boult now switches itself into plan mode and shows you a reviewable plan before touching anything.',
          'Simple asks still just get done — the switch is reserved for work that deserves your sign-off first.',
        ],
      },
    ],
  },
  {
    date: 'July 13, 2026',
    entries: [
      {
        tag: 'New',
        title: 'Boult runs your outreach — hand it a list, approve once',
        points: [
          'Paste a list or attach a CSV and say "email these 40 people about…" — Boult researches each person, writes every email individually in your voice, and shows you samples.',
          'One approval covers the whole batch. After your yes, emails go out paced like a human sends them — spread over days, business hours, minutes apart — so your Gmail reputation stays clean.',
          'Before a first bulk send from a custom domain, Boult checks your SPF/DMARC and tells you exactly what to fix if something\'s missing.',
          'Ask for a watcher and Boult sets up a scheduled agent that reads the replies, drafts responses in your voice with real openings from your calendar, nudges the silent ones once with a fresh angle, and never contacts anyone who opts out.',
          'Nothing new to learn — it\'s the same chat, the same agents, now trusted with bigger jobs.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Attachments actually reach Boult now',
        points: [
          'CSV and text files uploaded in chat were silently invisible to the AI. Fixed — attach a contact list or notes and Boult reads the real contents.',
        ],
      },
    ],
  },
  {
    date: 'July 11, 2026',
    entries: [
      {
        tag: 'Improved',
        title: 'Answers that read like a briefing, not a wall of text',
        points: [
          'Boult now structures substantive answers — clear sections, dividers, and a boxed "Bottom line" takeaway you can read at a glance.',
          'The quick-ask palette (Ctrl+K) renders it all beautifully: section labels, tidy lists, callout boxes.',
          'One-line questions still get one-line answers — no ceremony where none is needed.',
        ],
      },
      {
        tag: 'Improved',
        title: 'A calmer, smarter chat',
        points: [
          'Simple messages get a simple reply — the processing trace now only appears when Boult is doing real work.',
          'While it works, you see what it\'s actually thinking — a live reasoning line, updating in real time.',
          'Plan cards are fully legible in both themes, and their proposals are grounded in your real emails and events — one obvious right move stands alone instead of padded fake alternatives.',
          'Acting on a briefing recommendation now hands the request visibly into the chat composer — you review it and hit send.',
        ],
      },
      {
        tag: 'Improved',
        title: 'Onboarding that respects your time',
        points: [
          'The plan screen leads with what matters: "Start 3-day free trial", the real price you\'ll pay, and secure-checkout reassurance.',
          'A plan + price recap sits right before checkout, with a one-click way to change your mind.',
          'The live Boult demo can be skipped — it finishes in the background either way.',
          'Fixed two dead ends: returning from an abandoned checkout, and a scan that timed out, both now continue cleanly.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Light theme, everywhere',
        points: [
          'Every surface — chat cards, the inbox intelligence report, the agents page, draft review — is now fully legible in light and dark.',
          'Status colors, hover states, and selection indicators read correctly in both themes.',
        ],
      },
    ],
  },
  {
    date: 'July 10, 2026',
    entries: [
      {
        tag: 'New',
        title: 'Watch Boult work — a live, narrated trace',
        points: [
          'Every step shows the actual thing being done ("Scanning your inbox for unanswered investor threads"), not a bare tool name.',
          'Web steps show their real sources. Multi-step tasks show a live phase plan that checks off as work completes.',
          'Nothing in the trace can claim work that didn\'t happen — every line is grounded in what actually ran.',
        ],
      },
      {
        tag: 'New',
        title: 'A sharper, glassier interface',
        points: [
          'An Apple-grade design pass across the app: translucent surfaces, hairline boundaries, soft depth, smooth motion.',
          'Message bubbles, processing cards, result cards, drafts, confirmations — one consistent, premium language.',
        ],
      },
      {
        tag: 'Fixed',
        title: 'Your briefing never comes back empty',
        points: [
          'If the AI engine is briefly busy, recommendations now degrade to accurate picks built from your real inbox — overdue promises, replies waiting, follow-ups going quiet — instead of vanishing.',
        ],
      },
    ],
  },
  {
    date: 'Early July 2026',
    entries: [
      {
        tag: 'New',
        title: 'Transparent reasoning',
        points: [
          'Boult shows how it decided, not just what it decided — the tradeoff it weighed, what it ranked above what, and why.',
          'Your Today feed gained "Why this order?" — one tap reveals how the day was prioritized.',
        ],
      },
      {
        tag: 'New',
        title: 'The employee suite',
        points: [
          'Confidence receipts: every pick comes with the evidence it saw ("read 47, 3 need you").',
          'Approval mode: anything that leaves the building waits for your one-glance sign-off.',
          'Founder memory: Boult learns your VIPs, style, and priorities from how you work — and shows its recall.',
          'Continuous inbox: you review progress, not a backlog — "while you were away" leads with what was handled.',
          'Opportunity detection: quiet risks surface first, tagged "Before it slips".',
        ],
      },
      {
        tag: 'Improved',
        title: 'Instant, warm replies',
        points: [
          'Casual messages skip the machinery entirely — Boult answers in about a second, like a colleague texting back.',
        ],
      },
    ],
  },
];
