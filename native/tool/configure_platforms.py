from pathlib import Path
import plistlib
import re
import xml.etree.ElementTree as ET

ANDROID = 'http://schemas.android.com/apk/res/android'
ET.register_namespace('android', ANDROID)
manifest = Path('android/app/src/main/AndroidManifest.xml')
tree = ET.parse(manifest)
root = tree.getroot()
for permission in ['INTERNET', 'ACCESS_NETWORK_STATE', 'CHANGE_NETWORK_STATE']:
    name = f'android.permission.{permission}'
    if not any(e.get(f'{{{ANDROID}}}name') == name for e in root.findall('uses-permission')):
        ET.SubElement(root, 'uses-permission', {f'{{{ANDROID}}}name': name})
app = root.find('application')
app.set(f'{{{ANDROID}}}label', 'ハイテンション三目並べ')
activity = app.find('activity')
for meta in list(activity.findall('meta-data')):
    if meta.get(f'{{{ANDROID}}}name') == 'flutter_deeplinking_enabled':
        activity.remove(meta)
ET.SubElement(activity, 'meta-data', {f'{{{ANDROID}}}name': 'flutter_deeplinking_enabled', f'{{{ANDROID}}}value': 'false'})
if not any(e.get(f'{{{ANDROID}}}scheme') == 'hightension' for e in activity.findall('./intent-filter/data')):
    intent = ET.SubElement(activity, 'intent-filter')
    ET.SubElement(intent, 'action', {f'{{{ANDROID}}}name': 'android.intent.action.VIEW'})
    for category in ['DEFAULT', 'BROWSABLE']:
        ET.SubElement(intent, 'category', {f'{{{ANDROID}}}name': f'android.intent.category.{category}'})
    ET.SubElement(intent, 'data', {f'{{{ANDROID}}}scheme': 'hightension', f'{{{ANDROID}}}host': 'join'})
tree.write(manifest, encoding='utf-8', xml_declaration=True)

gradle = Path('android/app/build.gradle.kts')
text = gradle.read_text().replace('minSdk = flutter.minSdkVersion', 'minSdk = 24')
gradle.write_text(text)
# Current sharing plugins require recent Android build tooling.
settings = Path('android/settings.gradle.kts')
text = settings.read_text()
for plugin, minimum in [('com.android.application', '8.12.1'), ('org.jetbrains.kotlin.android', '2.2.0')]:
    pattern = rf'(id\("{re.escape(plugin)}"\) version ")([\d.]+)(")'
    def upgrade(match):
        parts = lambda v: tuple(int(x) for x in v.split('.'))
        return match.group(1) + (minimum if parts(match.group(2)) < parts(minimum) else match.group(2)) + match.group(3)
    text = re.sub(pattern, upgrade, text)
settings.write_text(text)
wrapper = Path('android/gradle/wrapper/gradle-wrapper.properties')
text = wrapper.read_text()
match = re.search(r'gradle-([\d.]+)-', text)
if match and tuple(map(int, match.group(1).split('.'))) < (8, 13):
    text = text.replace(f'gradle-{match.group(1)}-', 'gradle-8.13-')
wrapper.write_text(text)

plist = Path('ios/Runner/Info.plist')
data = plistlib.loads(plist.read_bytes())
data['CFBundleDisplayName'] = 'ハイテンション三目並べ'
data['FlutterDeepLinkingEnabled'] = False
data['CFBundleURLTypes'] = [{'CFBundleTypeRole': 'Editor', 'CFBundleURLSchemes': ['hightension']}]
plist.write_bytes(plistlib.dumps(data, fmt=plistlib.FMT_XML, sort_keys=False))
