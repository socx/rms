const wrap = (level) => (...args) => {
  if (process.env.NODE_ENV === 'test') return; // keep test output clean
  console[level](...args);
};

export default {
  info: wrap('info'),
  warn: wrap('warn'),
  error: wrap('error'),
  debug: wrap('log'),
};
