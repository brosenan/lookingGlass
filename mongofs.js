function MFS(coll, options) {
	this.coll = coll;
	options = options || {};
	this.maxVers = options.maxVers || 1;
}

function parsePath(path) {
	var splitPath = path.split('/');
	return {
		fileName: splitPath[splitPath.length - 1],
		dirPath: splitPath.slice(0, splitPath.length - 1).join('/') + '/'
	};
}

MFS.prototype.get = function(path, callback) {
	var parsedPath = parsePath(path);
	var proj = {};
	proj[parsedPath.fileName] = {$slice: -1};
	this.coll.find({_id: parsedPath.dirPath}, proj).toArray(function(err, docs) {
		try {
			if(err) return callback(err);
			if(docs.length < 1) {
				err = new Error('Path not found: ' + parsedPath.dirPath);
				err.fileNotFound = 1;
				return callback(err);
			}
			var vers = docs[0][parsedPath.fileName];
			if(!vers) {
				err = new Error('File not found: ' + path);
				err.fileNotFound = 1;
				return callback(err);
			}
			if(vers.length < 1) {
				return callback(new Error('No versions found for: ' + path));
			}
			if(vers[0]['/dead']) {
				err = new Error('File not found: ' + path);
				err.fileNotFound = 1;
				return callback(err);
			}
			callback(undefined, vers[0]);
		} catch(e) {
			callback(e);
			throw e;
		}
	});
}

MFS.prototype.put = function(path, content, callback) {
	if(!('/ts' in content)) {
		content['/ts'] = (new Date()).getTime();
	}
	var parsedPath = parsePath(path);
	var update = {};
	update[parsedPath.fileName] = {$each: [content], $slice: -this.maxVers, $sort: {'/ts':1}};
	var self = this;
	this.ensureParent(parsedPath.dirPath, function(err) {
		if(err) { return callback(err); }
		try {
			self.coll.update({_id: parsedPath.dirPath}, {$push: update}, {safe: true, upsert: true}, callback);
		} catch(e) {
			callback(e);
		}
	});
};

MFS.prototype.ensureParent = function(path, callback) {
	if(path == '/') {
		return callback();
	}
	var parsed = parsePath(path.substr(0, path.length - 1));
	var proj = {};
	proj[parsed.fileName] = 1;
	var self = this;
	this.coll.find({_id: parsed.dirPath}, proj).toArray(function(err, docs) {
		try {
			if(docs.length == 0) {
				// Parent directory does not exist.
				// Create and ensure parent.
				var doc = {_id: parsed.dirPath};
				doc[parsed.fileName] = 1;
				self.coll.insert(doc, function(err) {
					if(err) {
						return callback(err);
					}
					self.ensureParent(parsed.dirPath, callback);
				});
			} else {
				if(!docs[0][parsed.fileName]) {
					// Parent dir exists, but does not point to the child
					// Update it.
					var update = {};
					update[parsed.fileName] = 1;
					self.coll.update({_id: parsed.dirPath}, {$set: update}, {safe: true}, callback);
				} else {
					// All is well.
					// Nothing to do
					callback();
				}
			}
		} catch (e) {
			callback(e);
		}
	});
};

function batchPutKeys(self, keys, keyVals, callback) {
	if(keys.length == 0) {
		callback();
		return;
	}

	try {
		var key = keys.shift();
		self.put(key, keyVals[key], function(err) {
			if(err) {
				callback(err);
			} else {
				batchPutKeys(self, keys, keyVals, callback);
			}
		});
	} catch(e) {
		callback(e);
	}
}

MFS.prototype.batchPut = function(keyVals, callback) {
	var keys = [];
	for(var key in keyVals) {
		keys.push(key);
	}
	batchPutKeys(this, keys, keyVals, callback);
};

MFS.prototype.getDir = function(path, expandFiles, callback) {
	this.coll.find({_id: path}).toArray(function(err, docs) {
		try {
			if(err) {
				return callback(err);
			}
			if(docs.length < 1) {
				callback(new Error('Path not found: ' + path));
				return;
			}
			var doc = docs[0];
			if(expandFiles) {
				for(var name in doc) {
					var vers = doc[name];
					doc[name] = vers[vers.length - 1];
				}
			}
			callback(undefined, doc);
		} catch(e) {
			callback(e);
		}
	});
};
MFS.prototype.remove = function(path, timestamp, callback) {
	timestamp = timestamp || (new Date()).getTime();
	this.put(path, {'/ts': timestamp, '/dead': 1}, callback);
};

MFS.prototype.createMapping = function(path, mapping, callback) {
	var update = {};
	if(!('/ts' in mapping)) {
		mapping['/ts'] = (new Date()).getTime();
	}
	if(!('/uid' in mapping)) {
		mapping['/uid'] = Math.floor(Math.random() * 1000000000);
	}
	update['/map.' + mapping['/ts'] + '-' + mapping['/uid']] = mapping;
	this.coll.findAndModify({_id: path}, {_id: 1}, {$set: update}, {safe: true, upsert: true}, function(err, doc) {
		if(err) { return callback(err); }
		try {
			var actions = [];
			for(var key in doc) {
				if(key.charAt(0) == '/' || key.charAt(0) == '_') continue;
				if(Array.isArray(doc[key])) {
					actions.push({type: 'map', mapping: mapping, path: path + key});
				} else {
					actions.push({type: 'tramp', internalType: 'map', mapping: mapping, path: path + key + '/'});					
				}
			}
			return callback(undefined, actions);
		} catch(e) {
			return callback(err);
		}
	});
};
MFS.prototype.trampoline = function(action, callback) { 
	if(action.internalType == 'map') {
		this.createMapping(action.path, action.mapping, callback);
	}
};
exports.MFS = MFS;

