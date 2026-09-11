# Flatpack

Flatpack turns a narrated how-to video into a wordless, numbered instruction manual. Film yourself binding a sketchbook or fixing a bike puncture and say each step out loud. Flatpack finds the steps in your narration, picks a frame for each one and redraws it as clean line art with Livepeer Agent. You review the plates, fix any step by picking a better frame, then print the manual. On the bundled 3 minute sample it drew 8 plates for $0.34 of Livepeer credit: in 78 seconds on the run shown in the demo video and in 2 minutes 39 seconds on an earlier run.

Track: Livepeer Agent Builder (Track 1).

## Run it

Needs Node 22.9 or newer and ffmpeg on your PATH (`brew install ffmpeg` on macOS). No API key is needed: without one, Flatpack runs on Livepeer Agent's keyless demo credit.

```bash
git clone https://github.com/himanshu748/flatpack.git
cd flatpack
npm start
```

There are no npm dependencies to install. Open http://localhost:8787 and click **Try the sample video**, or drop in your own narrated video of up to 5 minutes.

```bash
npm test
```

To use your own Livepeer account, copy `.env.example` to `.env` and set `LIVEPEER_API_KEY` to a key from https://app.daydream.live.

## How it works

| Stage | Livepeer Agent capability | What it does |
|---|---|---|
| Listen | `upload`, then creative `transcribe` | Transcribes the narration in 10 second audio pieces, 6 at a time. Each piece's offset is its timestamp. |
| Split | `gemini-text` | Turns the timed transcript into at most 8 physical steps, each with the moment the action is most visible. |
| Frame | local ffmpeg | Grabs one frame per step from the video on your machine. |
| Focus | `yolo-detect` | Finds the person in wide shots so the frame can be cropped to the hands and the object. Close-ups are left alone. |
| Draw | `kontext-edit` | Redraws each frame as black line art on white, with logos and lettering removed. |
| Check | local ffmpeg | Measures how much of each plate is grey fill and flags plates that drifted from line art. |
| Spend | `get_cost_report` | Shows what the manual cost in the app. |

Your video never leaves your machine. Only the 10 second audio pieces and one frame per step are uploaded to Livepeer.

The review screen lets you redraw a plate, pick a better frame from the video, merge a step into the next one or remove it. Print gives a one-page A4 sheet of numbered plates.

## Known limitations

- The video must be narrated. Flatpack finds steps from what you say, not from what it sees.
- Steps are timed to within 10 seconds, so the chosen frame can land just before or after the action. Pick frame fixes it.
- A step that happens off camera gets a plate that shows something else. Merge it into the next step.
- Thin objects such as wire can disappear in the line art.
- The step list can differ between runs of the same video.
- Livepeer latency varies: transcribing the sample took 17 seconds in one run and 69 in another. The cost report alone takes 15 to 20 seconds.
- English narration only. Not suitable for safety-critical instructions.

## Livepeer Agent notes from building this

- `kontext-edit` needs `inputs.image_url`. The `source_url` shown on its capability card is refused before dispatch, so nothing is billed.
- Raw `whisper-word` and `nemotron-asr` failed with `stream_truncated` on every call during the build (refunded). The creative `transcribe` tool works but returns empty `srt` and `cues`, which is why Flatpack transcribes short pieces.
- `gemini-text` returns its answer inside a `{"text": ...}` envelope, often fenced as a JSON code block.
- `/a/` asset links redirect, so downloads must follow redirects.

## Credits

The sample video is "How to make a simple sketch book" by Boone Community Arts, Wikimedia Commons, CC BY-SA 4.0. Manuals drawn from it carry the same license. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Code: MIT, see [LICENSE](LICENSE).
