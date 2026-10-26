// craco.config.js
module.exports = {
    webpack: {
        configure: (webpackConfig) => {
            // @chartizer/graph-renderer is ESM-only with extension-less relative
            // imports (`export { GraphRenderer } from "./GraphRenderer"`). Webpack 5
            // treats .js in a "type":"module" package as fully-specified ESM and
            // refuses to add the ".js" extension. Vite doesn't, which is why it works
            // for your colleague. Re-enable extension resolution for .js files:
            webpackConfig.module.rules.push({
                test: /\.m?js$/,
                resolve: { fullySpecified: false },
            });
            return webpackConfig;
        },
    },
};
