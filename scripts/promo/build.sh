#!/bin/bash
# build.sh <lang> <out.mp4>  — joins scene frames with soft crossfades and adds music
set -e
cd "$(dirname "$0")"
L=$1; OUT=$2; X=0.8
SEGS=(heroz story look features end)
inputs=(); durs=()
for s in "${SEGS[@]}"; do
  n=$(ls out/$L/$s/*.jpg | wc -l)
  inputs+=(-framerate 30 -i "out/$L/$s/%05d.jpg")
  durs+=($(python3 -c "print($n/30)"))
done
fc=""; for i in 0 1 2 3 4; do fc+="[$i:v]scale=1920:1080,setsar=1,fps=30,format=yuv420p[s$i];"; done; prev="[s0]"; acc=0
for i in 1 2 3 4; do
  acc=$(python3 -c "print($acc+${durs[$((i-1))]}-$X)")
  fc+="${prev}[s$i]xfade=transition=fade:duration=$X:offset=$acc[v$i];"; prev="[v$i]"
done
total=$(python3 -c "print($acc+${durs[4]})")
python3 music.py out/music_$L.wav $total
fc+="${prev}fade=t=in:st=0:d=0.6,fade=t=out:st=$(python3 -c "print($total-1.0)"):d=1.0,format=yuv420p[v];[5:a]loudnorm=I=-20:TP=-2[a]"
ffmpeg -loglevel error -y "${inputs[@]}" -i out/music_$L.wav -filter_complex "$fc" -map "[v]" -map "[a]" \
  -c:v libx264 -preset slow -crf 19 -maxrate 6M -bufsize 12M -profile:v high -r 30 -c:a aac -b:a 192k -movflags +faststart -t $total "$OUT"
echo "$OUT $total"
