# __tests__/local-native-abi.test.ts — index

N1/N2: `preflightLocalNativeAbi` refuses `build/Release` addon with foreign `node_register_module_v<N>` (`node_abi`, path + `pnpm rebuild`); accepts matching ABI, N-API, `prebuilds/`, no addons. Real tmp-dir fixtures. See change: electron-local-link-node-compat.
