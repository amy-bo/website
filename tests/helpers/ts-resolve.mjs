// A test-only module hook: src/ imports siblings without an extension ('./core'), as the Workers bundler allows;
// Node needs the ".ts", so try it when the bare path is missing.
export async function resolve(specifier, context, next) {
	try { return await next(specifier, context); } catch (e) {
		if (e?.code === 'ERR_MODULE_NOT_FOUND' && /^\.\.?\//.test(specifier) && !/\.[a-z]+$/.test(specifier)) return next(specifier + '.ts', context);
		throw e;
	}
}
