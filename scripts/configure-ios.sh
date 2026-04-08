#!/bin/bash
# Configure iOS project for Foodvisor
INFO_PLIST="ios/App/App/Info.plist"

# === Permissions ===
/usr/libexec/PlistBuddy -c "Add :NSCameraUsageDescription string 'Foodvisor needs camera access to photograph your food'" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSPhotoLibraryUsageDescription string 'Foodvisor needs photo library access to select food images'" "$INFO_PLIST"

# === App Icon ===
ICON_SRC="public/icons/icon-512.png"
ICON_DST="ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
if [ -f "$ICON_SRC" ]; then
  sips -z 1024 1024 "$ICON_SRC" --out /tmp/icon_resized.png > /dev/null 2>&1
  sips -s format jpeg -s formatOptions 100 /tmp/icon_resized.png --out /tmp/icon_flat.jpg > /dev/null 2>&1
  sips -s format png /tmp/icon_flat.jpg --out "$ICON_DST" > /dev/null 2>&1
  rm -f /tmp/icon_resized.png /tmp/icon_flat.jpg
  echo "App icon set (alpha removed)"
fi

echo "iOS configuration complete"
