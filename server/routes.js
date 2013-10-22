(function() {
  'use strict';
  var filePath, logger, path;

  path = require('path');

  logger = require('./utils/logger');

  filePath = path.join(__dirname, '../client');

  exports.index = function(req, res) {
    var user;
    user = req.user || {
      guest: true
    };
    res.cookie('user', JSON.stringify(user));
    logger.debug('index request; user cookie: %s', JSON.stringify(user));
    return res.sendfile(path.join(filePath, 'index.html'));
  };

  exports.partials = function(req, res) {
    var name;
    name = req.params.name;
    return res.sendfile(path.join(filePath, 'views', name));
  };

}).call(this);
