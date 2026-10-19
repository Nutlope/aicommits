#!/usr/bin/env sh
# Renders the README images in .github/assets from the HTML sources in this
# folder with headless Chrome at 2x scale.
#
#   sh scripts/readme-assets/render.sh
#
# Set CHROME to a Chrome or Chromium binary when it is not in the default
# macOS location.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
out="$here/../../.github/assets"
chrome=${CHROME:-"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"}

mkdir -p "$out"

render() {
	name=$1
	width=$2
	height=$3
	"$chrome" \
		--headless=new \
		--disable-gpu \
		--hide-scrollbars \
		--force-device-scale-factor=2 \
		--virtual-time-budget=4000 \
		--window-size="$width,$height" \
		--screenshot="$out/$name.png" \
		"file://$here/$name.html" >/dev/null 2>&1
	echo "rendered .github/assets/$name.png"
}

render hero 1280 640
render commit 1280 700
render setup 1280 720
