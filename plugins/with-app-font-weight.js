// Android's "Bold text" setting (Settings › Display) draws text wider than React Native measured it,
// so the last character of tight text is clipped: ₹78,100 showed as ₹78,10. The activity is given a
// configuration without that adjustment, so the app's own font weights are what gets measured and drawn.
const { withMainActivity } = require('expo/config-plugins');

const MARKER = 'fontWeightAdjustment = 0';

const METHOD = `
  // Keep the app's own font weights: with Android's Bold text on, text draws wider than React Native
  // measures it and the last character is clipped (with-app-font-weight plugin).
  override fun attachBaseContext(newBase: Context) {
    val current = newBase.resources.configuration
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && current.fontWeightAdjustment != 0) {
      val config = Configuration(current)
      config.${MARKER}
      super.attachBaseContext(newBase.createConfigurationContext(config))
    } else {
      super.attachBaseContext(newBase)
    }
  }
`;

function addImport(source, name) {
  return source.includes(`import ${name}\n`) ? source : source.replace(/^(package [^\n]+\n)/, `$1import ${name}\n`);
}

module.exports = function withAppFontWeight(config) {
  return withMainActivity(config, (mod) => {
    if (mod.modResults.language !== 'kt') throw new Error('with-app-font-weight expects a Kotlin MainActivity');
    let source = mod.modResults.contents;
    if (!source.includes(MARKER)) {
      source = addImport(source, 'android.content.Context');
      source = addImport(source, 'android.content.res.Configuration');
      source = addImport(source, 'android.os.Build');
      source = source.replace(/(class MainActivity : ReactActivity\(\) \{\n)/, `$1${METHOD}`);
      if (!source.includes(MARKER)) throw new Error('with-app-font-weight could not find the MainActivity class');
    }
    mod.modResults.contents = source;
    return mod;
  });
};
