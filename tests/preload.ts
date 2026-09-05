/**
 * Preload khusus `bun test`: loader asset untuk import `.svg`.
 *
 * Runtime aplikasi (bun-plugin-tailwind di bunfig [serve.static]) mengekspos
 * import `.svg` sebagai string path asset; `bun test` tidak memuat plugin
 * tersebut sehingga import default-nya gagal ("Missing 'default' export").
 * Preload ini meniru perilaku runtime yang sama: default export = path file.
 */
Bun.plugin({
  name: "svg-asset-loader",
  setup(build) {
    build.onLoad({ filter: /\.svg$/ }, (args) => ({
      contents: `export default ${JSON.stringify(args.path)};`,
      loader: "js",
    }));
  },
});
