const log4js = require('log4js');

module.exports.getLogger = function(name, level = 'DEBUG') {
    const logger = log4js.getLogger(name);
    logger.setLevel(level);

    return logger;
};
