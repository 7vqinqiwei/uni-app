const path = require('path')
const webpack = require('webpack')

const {
  parseEntry,
  getMainEntry,
  // normalizePath,
  getPlatformExts,
  getPlatformCssnano
} = require('@dcloudio/uni-cli-shared')

const WebpackUniAppPlugin = require('../../packages/webpack-uni-app-loader/plugin/index')

const modifyVueLoader = require('../vue-loader')

const {
  createTemplateCacheLoader
} = require('../cache-loader')

function createUniMPPlugin () {
  const WebpackUniMPPlugin = require('@dcloudio/webpack-uni-mp-loader/lib/plugin/index-new')
  return new WebpackUniMPPlugin()
}

function getProvides () {
  const uniPath = require('@dcloudio/uni-cli-shared/lib/platform').getMPRuntimePath()
  const uniCloudPath = path.resolve(__dirname, '../../packages/uni-cloud/dist/index.js')
  const provides = {
    uni: [uniPath, 'default'],
    uniCloud: [uniCloudPath, 'default']
  }

  if (process.env.UNI_USING_VUE3) {
    provides.uni = ['@dcloudio/uni-' + process.env.UNI_PLATFORM + '/dist/uni.api.esm.js', 'default']
    provides.createMiniProgramApp = [uniPath, 'createApp']
  }

  if (process.env.UNI_USING_COMPONENTS) {
    if (process.env.UNI_SUBPACKGE) {
      provides.createApp = [uniPath, 'createSubpackageApp']
    } else {
      provides.createApp = [uniPath, 'createApp']
    }
    provides.createPage = [uniPath, 'createPage']
    provides.createComponent = [uniPath, 'createComponent']
  }

  if (
    process.env.UNI_PLATFORM === 'app-plus' &&
    process.env.UNI_USING_V8
  ) {
    provides.__f__ = [path.resolve(__dirname, '../format-log.js'), 'default']

    const cryptoProvide = [path.resolve(__dirname, '../crypto.js'), 'default']
    provides.crypto = cryptoProvide
    provides['window.crypto'] = cryptoProvide
    provides['global.crypto'] = cryptoProvide
  }

  // TODO 目前依赖库 megalo 通过判断 wx 对象是否存在来识别平台做不同处理
  if (
    process.env.UNI_PLATFORM !== 'mp-qq' &&
    process.env.UNI_PLATFORM !== 'mp-weixin' &&
    process.env.UNI_PLATFORM !== 'app-plus'
  ) { // 非微信小程序，自动注入 wx 对象
    provides.wx = provides.uni
  }
  return provides
}

function processWxss (name, assets) {
  const dirname = path.dirname(name)
  const mainWxssCode = `@import "${path.relative(dirname, 'common/main.wxss')}";`
  const code = `${mainWxssCode}` + assets[name].source().toString()
  assets[name] = {
    size () {
      return Buffer.byteLength(code, 'utf8')
    },
    source () {
      return code
    }
  }
}

function procssJs (name, assets, hasVendor) {
  const dirname = path.dirname(name)
  const runtimeJsCode = `require('${path.relative(dirname, 'common/runtime.js')}');`
  const vendorJsCode = hasVendor ? `require('${path.relative(dirname, 'common/vendor.js')}');` : ''
  const mainJsCode = `require('${path.relative(dirname, 'common/main.js')}');`
  const code = `${runtimeJsCode}${vendorJsCode}${mainJsCode}` + assets[name].source().toString()
  assets[name] = {
    size () {
      return Buffer.byteLength(code, 'utf8')
    },
    source () {
      return code
    }
  }
}

class PreprocessAssetsPlugin {
  apply (compiler) {
    compiler.hooks.emit.tap('PreprocessAssetsPlugin', compilation => {
      const assets = compilation.assets
      const hasMainWxss = assets['common/main.wxss']
      const hasVendor = assets['common/vendor.js']
      Object.keys(assets).forEach(name => {
        if (name.startsWith('common')) {
          return
        }
        const extname = path.extname(name)
        if (extname === '.wxss' && hasMainWxss && process.UNI_ENTRY[name.replace(extname, '')]) {
          processWxss(name, assets)
        } else if (extname === '.js') {
          procssJs(name, assets, hasVendor)
        }
      })
      // delete assets['common/main.js']
      delete assets['app.js']
      delete assets['app.json']
      delete assets['app.wxss']
      delete assets['project.config.json']
    })
  }
}

function initSubpackageConfig (webpackConfig, vueOptions) {
  if (process.env.UNI_OUTPUT_DEFAULT_DIR === process.env.UNI_OUTPUT_DIR) { // 未自定义output
    process.env.UNI_OUTPUT_DIR = path.resolve(process.env.UNI_OUTPUT_DIR, process.env.UNI_SUBPACKGE)
  }
  vueOptions.outputDir = process.env.UNI_OUTPUT_DIR
  webpackConfig.output.path(process.env.UNI_OUTPUT_DIR)
  webpackConfig.output.jsonpFunction('webpackJsonp_' + process.env.UNI_SUBPACKGE)
}

module.exports = {
  vueConfig: {
    parallel: false
  },
  webpackConfig (webpackConfig, vueOptions, api) {
    if (!webpackConfig.optimization) {
      webpackConfig.optimization = {}
    }
    // disable noEmitOnErrors
    webpackConfig.optimization.noEmitOnErrors = false

    webpackConfig.optimization.runtimeChunk = {
      name: 'common/runtime'
    }

    webpackConfig.optimization.splitChunks = require('../split-chunks')()

    parseEntry()

    const statCode = process.env.UNI_USING_STAT ? 'import \'@dcloudio/uni-stat\';' : ''

    const beforeCode = 'import \'uni-pages\';'

    const plugins = [
      new WebpackUniAppPlugin(),
      createUniMPPlugin(),
      new webpack.ProvidePlugin(getProvides())
    ]

    if (process.env.UNI_SUBPACKGE && process.env.UNI_SUBPACKGE !== 'main') {
      plugins.push(new PreprocessAssetsPlugin())
    }

    return {
      mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
      entry () {
        return process.UNI_ENTRY
      },
      output: {
        filename: '[name].js',
        chunkFilename: '[id].js',
        globalObject: process.env.UNI_PLATFORM === 'mp-alipay' ? 'my' : 'global'
        // sourceMapFilename: '../.sourcemap/' + process.env.UNI_PLATFORM + '/[name].js.map'
      },
      performance: {
        hints: false
      },
      resolve: {
        extensions: ['.nvue'],
        alias: { // 仅 mp-weixin
          'mpvue-page-factory': require.resolve(
            '@dcloudio/vue-cli-plugin-uni/packages/mpvue-page-factory')
        }
      },
      module: {
        rules: [{
          test: path.resolve(process.env.UNI_INPUT_DIR, getMainEntry()),
          use: [{
            loader: path.resolve(__dirname, '../../packages/wrap-loader'),
            options: {
              before: [
                beforeCode + require('../util').getAutomatorCode() + statCode
              ]
            }
          }, {
            loader: '@dcloudio/webpack-uni-mp-loader/lib/main'
          }]
        }, {
          resourceQuery: /vue&type=script/,
          use: [{
            loader: '@dcloudio/webpack-uni-mp-loader/lib/script'
          }]
        }, {
          resourceQuery: /vue&type=template/,
          use: [{
            loader: '@dcloudio/webpack-uni-mp-loader/lib/template'
          }, {
            loader: '@dcloudio/vue-cli-plugin-uni/packages/webpack-uni-app-loader/page-meta'
          }]
        }, createTemplateCacheLoader(api), {
          resourceQuery: [
            /lang=wxs/,
            /lang=filter/,
            /lang=sjs/,
            /blockType=wxs/,
            /blockType=filter/,
            /blockType=sjs/
          ],
          use: [{
            loader: require.resolve(
              '@dcloudio/vue-cli-plugin-uni/packages/webpack-uni-filter-loader')
          }]
        }]
      },
      plugins
    }
  },
  chainWebpack (webpackConfig, vueOptions, api) {
    if (process.env.UNI_PLATFORM === 'mp-baidu') {
      webpackConfig.module
        .rule('js')
        .exclude
        .add(/\.filter\.js$/)
    }

    const compilerOptions = process.env.UNI_USING_COMPONENTS ? {} : require('../mp-compiler-options')

    modifyVueLoader(webpackConfig, {}, compilerOptions, api)

    const styleExt = getPlatformExts().style

    webpackConfig.plugin('extract-css')
      .init((Plugin, args) => new Plugin({
        filename: '[name]' + styleExt
      }))

    if (
      process.env.NODE_ENV === 'production' &&
      process.env.UNI_PLATFORM !== 'app-plus'
    ) {
      const OptimizeCssnanoPlugin = require('../../packages/@intervolga/optimize-cssnano-plugin/index.js')
      webpackConfig.plugin('optimize-css')
        .init((Plugin, args) => new OptimizeCssnanoPlugin({
          sourceMap: false,
          filter (assetName) {
            return path.extname(assetName) === styleExt
          },
          cssnanoOptions: {
            preset: [
              'default',
              Object.assign({}, getPlatformCssnano(), {
                discardComments: true
              })
            ]
          }

        }))
    }

    if (process.env.UNI_SUBPACKGE) {
      initSubpackageConfig(webpackConfig, vueOptions)
    }

    webpackConfig.plugins.delete('hmr')
    webpackConfig.plugins.delete('html')
    webpackConfig.plugins.delete('copy')
    webpackConfig.plugins.delete('preload')
    webpackConfig.plugins.delete('prefetch')
  }
}
