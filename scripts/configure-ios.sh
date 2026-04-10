#!/bin/bash
# Configure iOS project for Foodvisor
INFO_PLIST="ios/App/App/Info.plist"
ENTITLEMENTS="ios/App/App/App.entitlements"

# === Permissions ===
/usr/libexec/PlistBuddy -c "Add :NSCameraUsageDescription string 'Foodvisor needs camera access to photograph your food'" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSPhotoLibraryUsageDescription string 'Foodvisor needs photo library access to select food images'" "$INFO_PLIST"

# HealthKit permissions
/usr/libexec/PlistBuddy -c "Add :NSHealthShareUsageDescription string 'Foodvisor reads your weight, height and activity to personalize your nutritional goals'" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :NSHealthUpdateUsageDescription string 'Foodvisor logs your calories and macronutrients to Apple Health'" "$INFO_PLIST"

# === HealthKit Entitlements ===
cat > "$ENTITLEMENTS" << 'ENTXML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.developer.healthkit</key>
  <true/>
  <key>com.apple.developer.healthkit.access</key>
  <array/>
</dict>
</plist>
ENTXML
echo "HealthKit entitlements created"

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

# === Dark Launch Screen ===

LAUNCH_STORYBOARD="ios/App/App/LaunchScreen.storyboard"
cat > "$LAUNCH_STORYBOARD" << 'LAUNCHXML'
<?xml version="1.0" encoding="UTF-8"?>
<document type="com.apple.InterfaceBuilder3.CocoaTouch.Storyboard.XIB" version="3.0" toolsVersion="32700.99.1234" targetRuntime="AppleSDK" propertyAccessControl="none" useAutolayout="YES" launchScreen="YES" useTraitCollections="YES" useSafeAreas="YES" colorMatched="YES" initialViewController="01J-lp-oVM">
    <scenes>
        <scene sceneID="EHf-IW-A2E">
            <objects>
                <viewController id="01J-lp-oVM" sceneMemberID="viewController">
                    <view key="view" contentMode="scaleToFill" id="Ze5-6b-2t3">
                        <rect key="frame" x="0.0" y="0.0" width="393" height="852"/>
                        <autoresizingMask key="autoresizingMask" widthSizable="YES" heightSizable="YES"/>
                        <color key="backgroundColor" red="0.102" green="0.094" blue="0.078" alpha="1" colorSpace="custom" customColorSpace="sRGB"/>
                    </view>
                </viewController>
                <placeholder placeholderIdentifier="IBFirstResponder" id="iYj-Kq-Ea1" userLabel="First Responder" sceneMemberID="firstResponder"/>
            </objects>
            <point key="canvasLocation" x="53" y="375"/>
        </scene>
    </scenes>
</document>
LAUNCHXML
echo "Dark launch screen installed"

echo "iOS configuration complete"
