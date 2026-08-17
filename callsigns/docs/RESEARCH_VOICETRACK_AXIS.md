# Research — what automation actually buys and costs a radio station

Rule 4, before rule 1. Gate VT-1 failed because v9's voice-tracking has one
benefit (load relief) and three costs (appeal, zero attention, and — see below —
*more* fault risk, not less). That is not a trade, it is a penalty with a
discount. This is what the real trade is.

## Why stations voice-track

Voice tracking is pre-recording the breaks and letting automation assemble them
against the music and spot logs. Every source agrees on the same four reasons,
and the order matters:

1. **Unattended operation.** The station runs overnight, weekends and holidays
   without a body in the building. The FCC has permitted this without prior
   approval since 1995, on the reasoning that modern monitoring equipment and
   transmitter reliability made a person standing by unnecessary.
2. **Reliability.** Automation "minimises the risk of technical glitches,
   unexpected interruptions, or human errors that may occur during live
   broadcasts." A recorded break does not get tired, does not double-shift,
   does not leave nine seconds of dead air.
3. **Reach per person.** One personality covers multiple dayparts, and in
   consolidated groups multiple markets.
4. **Cost.** Fewer bodies for the same hours on the air.

## What it costs

**Locality**, which is the criticism the trade press and Wikipedia both lead
with — "the sense of locality is lost, especially when a station employs a disc
jockey who has never set foot in that station's town." That is the loss v9
already models as `TRACK_APPEAL = 0.88`, and modelling it is correct.

**But the sharp edge is not the sound of it — it is what happens when the town
needs the station.** The canonical case: on 21 January 2002 a train derailed at
Minot, North Dakota and released about 250,000 gallons of anhydrous ammonia.
KCJB(AM), the designated EAS primary, was running automated overnight off
another city's feed. Police could not activate the alert; no public warning went
out for roughly ninety minutes; authorities ended up reading the phone book and
calling Clear Channel employees at home to get someone into the building. One
person died and hundreds were injured. Whatever one concludes about the
consolidation argument around it, the operational fact is the one that matters
here: **an automated daypart cannot answer something happening in its own town.**

The regulator draws the same line. Unattended operation is permitted, but the
station must still receive, retransmit and log EAS alerts, and an automated
system that cannot correct a malfunction must take the transmitter off the air
within three hours. Automation removes the operator, never the obligation.

## The defect this exposes in v9

`setSlotMode()` scrubs the engineer off a tracked slot — correctly, because an
engineer who costs no person-hours while still dividing fault risk is a free
scarce resource. But `slotRisk()` is unchanged, so a tracked slot carries
`BASE_RISK · load · segRiskMul` **undivided**. In v9, tracking a slot makes it
*more* likely to fault, not less.

That is backwards on the single point every source agrees on. Automation's
selling point is that it does not make human mistakes. The load-driven fault in
this game is a human mistake — a person under load, on a desk, getting it wrong.

## What this says the second axis should be

Two-sided, both sides drawn from the operational reality rather than invented:

- **Tracked slots should not carry the load-driven fault.** Nobody is on the
  desk to be tired. This is reason 2 above, and it is currently inverted.
- **Tracked slots should be unable to answer a breaking local event.** A live
  slot turns the derailment, the ice storm, the school closing into the reason
  the town keeps the station on. A tracked slot plays the next record through
  it. This is Minot, and it is the cost that has teeth, because it scales with
  how much the town is listening rather than with a flat 12% appeal haircut.

Then the decision is genuinely two-sided: **tracking trades the risk you can
see coming (a tired host on a loaded desk) for the risk you cannot (the day the
town needs you live)** — and which of those dominates depends on roster depth,
which is exactly the reversal VT-1 was written to detect.

## Sources

- [Voice-tracking — Wikipedia](https://en.wikipedia.org/wiki/Voice-tracking)
- [Radio Voice Tracking Guide — RadioCult](https://www.radiocult.fm/radio-bootcamp/radio-voice-tracking-guide)
- [How Voice Tracking Works and How It Can Help Your Radio Station — Streamerr](https://blog.streamerr.co/untitled-9/)
- [Automation — Museum of Broadcast Communications](https://www.museum.tv/radio-encyclopedia/automation)
- [Minot train derailment — Wikipedia](https://en.wikipedia.org/wiki/Minot_train_derailment)
- [The whole story about that toxic spill and the Clear Channel "monopoly" — Slate](https://slate.com/news-and-politics/2007/01/the-whole-story-about-that-toxic-spill-and-the-clear-channel-monopoly.html)
- [Unattended Operation of Radio and Television Stations — FCC](https://www.fcc.gov/media/radio/unattended-operation)
- [LPFM Checklist: Emergency Alert System (EAS) — REC Networks](https://recnet.com/checklist-eas)
