// More heap for the Android release build.
//
// With Skia, VisionCamera, MLKit and the rest for four ABIs, the release APK
// is over 200 MB, and Gradle's packaging step ran out of memory with the
// template's 2 GB (`OutOfMemoryError` in :app:packageRelease). 4 GB is
// enough on the booth laptop.
const { withGradleProperties } = require("expo/config-plugins");

const JVM_ARGS = "-Xmx4096m -XX:MaxMetaspaceSize=1024m";

module.exports = function withAndroidBuildMemory(config) {
  return withGradleProperties(config, (mod) => {
    const props = mod.modResults.filter(
      (item) => !(item.type === "property" && item.key === "org.gradle.jvmargs"),
    );
    props.push({ type: "property", key: "org.gradle.jvmargs", value: JVM_ARGS });
    mod.modResults = props;
    return mod;
  });
};
