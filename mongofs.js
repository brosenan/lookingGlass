var util = require('./util.js');

function MFS(coll, options) {
	this.coll = coll;
	options = options || {};
	this.maxVers = options.maxVers || 1;
	this.encoder = new util.Encoder('-_/*%');
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
	this.transaction({
		path: parsedPath.dirPath,
		get: [parsedPath.fileName]
	}, util.protect(callback, function(err, actions) {
		callback(undefined, actions[0].content);
	}));
}

MFS.prototype.createMappingActions = function(action, path, content, mappings) {
	var actions = [];
	if(content._dead) return [];

	for(key in mappings) {
		actions.push({type: action, mapping: mappings[key], path: path, content: content});
	}
	return actions;
}

MFS.prototype.put = function(path, content, callback) {
	var parsedPath = parsePath(path);
	var put = {};
	put[parsedPath.fileName] = content;
	var trans = {
		path: parsedPath.dirPath,
		put: put
	};
	if(content._ts) {
		trans._ts = content._ts;
	}
	this.transaction(trans, callback);
};

MFS.prototype.ensureParent = function(path, callback) {
	if(path == '/') {
		return callback();
	}
	var parsed = parsePath(path.substr(0, path.length - 1));
	var proj = {};
	proj['f.' + parsed.fileName] = 1;
	var self = this;
	this.coll.find({_id: parsed.dirPath}, proj).toArray(util.protect(callback, function(err, docs) {
		if(docs.length == 0) {
			// Parent directory does not exist.
			// Create and ensure parent.
			var doc = {_id: parsed.dirPath, f:{}};
			doc.f[parsed.fileName + '/'] = 1;
			self.coll.insert(doc, function(err) {
				if(err) {
					return callback(err);
				}
				self.ensureParent(parsed.dirPath, callback);
			});
		} else {
			if(!docs[0].f || !docs[0].f[parsed.fileName]) {
				// Parent dir exists, but does not point to the child
				// Update it.
				var update = {};
				update['f.' + parsed.fileName + '/'] = 1;
				self.coll.update({_id: parsed.dirPath}, {$set: update}, {safe: true}, callback);
			} else {
				// All is well.
				// Nothing to do
				callback();
			}
		}
	}));
};

function batchPutKeys(self, keys, keyVals, callback) {
	if(keys.length == 0) {
		return callback();
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
		keys.push(this.encoder.encode(key));
	}
	batchPutKeys(this, keys, keyVals, callback);
};

MFS.prototype.getDir = function(path, expandFiles, callback) {
	path = this.encoder.encode(path);
	this.coll.find({_id: path}).toArray(util.protect(callback, function(err, docs) {
		if(docs.length < 1) {
			callback(new Error('Path not found: ' + path));
			return;
		}
		var doc = docs[0].f;
		if(expandFiles) {
			for(var name in doc) {
				var vers = doc[name];
				doc[name] = vers[vers.length - 1];
			}
		}
		callback(undefined, doc);
	}));
};
MFS.prototype.remove = function(path, timestamp, callback) {
	timestamp = timestamp || util.timeUid();
	this.put(path, {_ts: timestamp, _dead: 1}, callback);
};

MFS.prototype.createMapping = function(path, mapping, callback) {
	path = this.encoder.encode(path);
	var update = {};
	if(!('_ts' in mapping)) {
		mapping._ts = util.timeUid();
	}
	update['m.' + mapping._ts] = mapping;
	var self = this;
	this.coll.findAndModify({_id: path}, {_id: 1}, {$set: update}, {safe: true, upsert: true, fields: {f: 1}}, util.protect(callback, function(err, doc) {
		var actions = [];
		var files = doc.f;
		for(var key in files) {
			if(key.charAt(key.length-1) != '/') {
				var vers = files[key];
				if(vers.length == 0) continue;
				var lastVer = vers[vers.length - 1];
				if(lastVer._dead) continue;
				actions.push({type: 'map', mapping: mapping, path: self.encoder.decode(path + key), value: lastVer});
			} else {
				actions.push({type: 'tramp', internalType: 'map', mapping: mapping, path: self.encoder.decode(path + key)});					
			}
		}
		return callback(undefined, actions);
	}));
};
MFS.prototype.trampoline = function(action, callback) { 
	if(action.internalType == 'map') {
		this.createMapping(action.path, action.mapping, callback);
	} else if(action.internalType == 'unmap') {
		this.removeMapping(action.path, action.mapping._ts, callback);
	} else {
		return callback(new Error('Operation ' + action.internalType + ' not supported'));
	}
};

MFS.prototype.removeMapping = function(path, ts, callback) {
	path = this.encoder.encode(path);
	var unset = {};
	unset['m.' + ts] = 0;
	var fields = {f:1};
	fields['m.' + ts] = 1;
	var self = this;
	this.coll.findAndModify({_id: path}, {_id:1}, {$unset: unset}, {safe: true, fields: fields}, util.protect(callback, function(err, doc) {
		var files = doc.f;
		if(!files) {
			return callback(undefined, []);
		}
		var mapping = doc.m[ts];
		if(!mapping) {
			throw new Error('No mapping ' + ts + ' at path ' + path);
		}
		var actions = [];
		for(key in files) {
			if(key.charAt(key.length-1) != '/') {
				actions.push({type: 'unmap', mapping: mapping, path: self.encoder.decode(path + key)});
			} else {
				actions.push({type: 'tramp', internalType: 'unmap', mapping: mapping, path: self.encoder.decode(path + key)});					
			}
		}
		callback(undefined, actions);
	}));
};
function hasFields(obj) {
	for(var k in obj) {
		return true;
	}
	return false;
}

MFS.prototype.transaction = function(trans, callback) {
	if(!('_ts' in trans)) {
		trans._ts = util.timeUid();
	}
	trans.path = this.encoder.encode(trans.path);
	var update = {};
	var fields = {};
	for(var key in trans) {
		var methodName = 'pre_' + key;
		if(this[methodName]) {
			this[methodName](trans[key], update, fields, trans._ts);
		}
	}
	var self = this;
	var post = util.protect(callback, function(err, doc) {
		var dirDoesNotExist = false;
		if(!doc || !doc._id) {
			dirDoesNotExist = true;
			doc = {};
		}
		var actions = [];
		for(var key in trans) {
			var methodName = 'post_' + key;
			if(self[methodName]) {
				self[methodName](trans[key], trans.path, doc, actions);
			}
		}
		for(var i = 0; i < actions.length; i++) {	
			if(actions[i].path) {
				actions[i].path = self.encoder.decode(actions[i].path);
			}
		}
		if(dirDoesNotExist) {
			self.ensureParent(trans.path, util.protect(callback, function() { callback(undefined, actions); }));
		} else {
			callback(undefined, actions);
		}
	});
	if(hasFields(update)) {
		this.coll.findAndModify({_id: trans.path}, {_id:1}, update, {safe: true, upsert: true, fields: fields}, post);
	} else {
		this.coll.findOne({_id: trans.path}, fields, post);
	}
};

MFS.prototype.pre_get = function(get, update, fields) {
	for(var i = 0; i < get.length; i++) {
		var field = this.encoder.encode(get[i]);
		fields['f.' + field] = 1;
	}
};

MFS.prototype.post_get = function(get, path, doc, actions) {
	for(var i = 0; i < get.length; i++) {
		var field = this.encoder.encode(get[i]);
		if(!doc.f) { this.throwFileNotFoundExeption(path + field); }
		if(!(field in doc.f)) { this.throwFileNotFoundExeption(path + field); }
		var vers = doc.f[field];
		if(vers.length == 0) throw new Error('Zero versions left for file ' + field);
		var content = vers[vers.length - 1];
		if(content._dead) { this.throwFileNotFoundExeption(path + field); }
		actions.push({type: 'content', path: path + field, content: content});
	}
};

function removeFieldsStartingWith(obj, prefix) {
	for(var field in obj) {
		if(field.substr(0, prefix.length) == prefix) {
			delete obj[field];
		}
	}
}

MFS.prototype.pre_put = function(put, update, fields, ts) {
	if(!update.$push) {
		update.$push = {};
	}
	for(var field in put) {
		put[field]._ts = ts;
		var content = put[field];
		field = this.encoder.encode(field);
		update.$push['f.' + field] = {$each: [content], $slice: -this.maxVers, $sort: {_ts:1}};
		fields['f.' + field] = 1;
	}
	removeFieldsStartingWith(fields, 'm.');
	fields.m = 1;
};

function arrayAppend(array, arrayToAppend) {
	for(var i = 0; i < arrayToAppend.length; i++) {
		array.push(arrayToAppend[i]);
	}
}

MFS.prototype.post_put = function(put, path, doc, actions) {
	var mappings = doc.m;
	if(doc.f) {
		for(var field in put) {
			field = this.encoder.encode(field);
			var content = put[field];
			var vers = doc.f[field];
			if(vers) {
				var latest = vers[vers.length - 1];
				if(latest._ts < content._ts) {
					arrayAppend(actions, this.createMappingActions('map', path + field, content, mappings)
						.concat(this.createMappingActions('unmap', path + field, latest, mappings)));
				}
			} else {
				arrayAppend(actions, this.createMappingActions('map', path + field, content, mappings));
			}
		}
	} else if(mappings) {
		for(var field in put) {
			var content = put[field];
			arrayAppend(actions, this.createMappingActions('map', path + field, content, mappings));
		}
	}
};

MFS.prototype.throwFileNotFoundExeption = function(path) {
	var err = new Error('File not found: ' + path);
	err.fileNotFound = 1;
	throw err;
}

exports.MFS = MFS;

