// Extends app.json. Registers the reversed Google client ids as URL schemes so Google sign-in can redirect back to
// the app (required for the Android/iOS OAuth client types). Reads EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID and
// EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID at build time. Without them the app builds exactly as before and Google sign-in is hidden.
const reversed = (id) => {
  const m = /^([0-9]+-[a-z0-9]+)\.apps\.googleusercontent\.com$/i.exec((id || '').trim());
  return m ? `com.googleusercontent.apps.${m[1]}` : null;
};

module.exports = ({ config }) => {
  const schemes = [].concat(config.scheme || []);
  for (const id of [process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID, process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID]) {
    const r = reversed(id);
    if (r && !schemes.includes(r)) schemes.push(r);
  }
  return { ...config, scheme: schemes.length > 1 ? schemes : schemes[0] };
};
