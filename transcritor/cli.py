import argparse
import os
from pathlib import Path

from transcritor.engine import detect_device, load_whisper_model, transcribe_file


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="GPU-first transcription for OBS MP4 to Markdown")
    parser.add_argument("inputs", nargs="+", help="Input .mp4 files")
    parser.add_argument("--out-dir", help="Output directory for .md files")
    parser.add_argument("--output", help="Output file path (only for single input)")
    parser.add_argument("--model", default="large-v3", help="Whisper model name")
    parser.add_argument("--language", default="pt", help="Language code")
    parser.add_argument(
        "--device",
        default="auto",
        choices=["auto", "cuda", "cpu"],
        help="Device selection",
    )
    parser.add_argument("--device-index", type=int, default=0)
    parser.add_argument(
        "--compute-type",
        default="float16",
        help="CTranslate2 compute type (float16, int8_float16, int8, etc)",
    )
    parser.add_argument(
        "--cpu-threads",
        type=int,
        default=os.cpu_count() or 8,
        help="CPU threads for decoding",
    )
    parser.add_argument("--num-workers", type=int, default=1)
    parser.add_argument("--beam-size", type=int, default=5)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--vad", dest="vad", action="store_true")
    parser.add_argument("--no-vad", dest="vad", action="store_false")
    parser.set_defaults(vad=True)
    parser.add_argument("--vad-min-silence-ms", type=int, default=500)
    parser.add_argument("--word-timestamps", action="store_true")
    parser.add_argument("--diarize", action="store_true")
    parser.add_argument("--hf-token", help="Hugging Face token for diarization")
    parser.add_argument(
        "--merge-gap",
        type=float,
        default=0.7,
        help="Merge same-speaker segments if gap <= seconds; use -1 to disable",
    )
    parser.add_argument("--no-merge", action="store_true")
    parser.add_argument("--keep-wav", action="store_true")

    return parser.parse_args()


def main() -> int:
    args = parse_args()

    if args.output and len(args.inputs) > 1:
        raise SystemExit("--output only works with a single input file")

    device = detect_device(args.device)
    model = load_whisper_model(
        model_name=args.model,
        device=device,
        device_index=args.device_index,
        compute_type=args.compute_type,
        cpu_threads=args.cpu_threads,
        num_workers=args.num_workers,
    )

    for input_item in args.inputs:
        input_path = Path(input_item)
        if not input_path.exists():
            raise SystemExit(f"Input not found: {input_path}")

        if args.output:
            output_path = Path(args.output)
        else:
            out_dir = Path(args.out_dir) if args.out_dir else input_path.parent
            output_path = out_dir / f"{input_path.stem}.md"

        merge_gap = -1.0 if args.no_merge else args.merge_gap

        output = transcribe_file(
            input_path=input_path,
            output_path=output_path,
            model=model,
            model_name=args.model,
            language=args.language,
            device=device,
            device_index=args.device_index,
            compute_type=args.compute_type,
            cpu_threads=args.cpu_threads,
            num_workers=args.num_workers,
            beam_size=args.beam_size,
            batch_size=args.batch_size,
            vad_filter=args.vad,
            vad_min_silence_ms=args.vad_min_silence_ms,
            word_timestamps=args.word_timestamps,
            diarize=args.diarize,
            hf_token=args.hf_token,
            merge_gap_s=merge_gap,
            keep_wav=args.keep_wav,
        )

        print(f"Wrote: {output}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
