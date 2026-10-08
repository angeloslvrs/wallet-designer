#!/bin/zsh
# usage: _shot.sh file.html screen [height]
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
f=$1; s=$2; h=${3:-860}
"$CH" --headless=new --disable-gpu --hide-scrollbars --virtual-time-budget=4000 --window-size=1340,$h --screenshot="$PWD/shots/${f%.html}-$s.png" "file://$PWD/$f#$s" 2>/dev/null
