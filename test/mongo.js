var assert = require("assert");
var mongofs = require("../mongofs.js");
var mongodb = require("mongodb");

function protect(done, func) {
	return function() {
		try {
			return func.apply(this, arguments);
		} catch(e) {
			done(e);
			throw e;
		}
	}
}

function trampoline(mfs, actions, callback) {
	for(var i = 0; i < actions.length; i++) {
		var action = actions[i];
		if(action.type == 'tramp') {
			actions.splice(i, 1);
			mfs.trampoline(action, function(err, newActions) {
				actions = actions.concat(newActions);
				trampoline(mfs, actions, callback);
			});
			return;
		}
		// Found no trampoline actions
		callback(undefined, actions);
	}
}

describe('MongoFS', function() {
	var mfs;
	var coll;
	before(function(done) {
		mongodb.MongoClient.connect('mongodb://127.0.0.1:27017/test', function(err, db) {
			if(err) return done(err);
			coll = db.collection('test');
			mfs = new mongofs.MFS(coll);
			coll.remove({}, done);
		});
	});
	

	
	after(function(done) {
		coll.remove({}, done);
	});

	describe('.get(path, callback(err, file))', function() {
		before(function(done) {
			coll.insert({
				_id: '/hello/', 
				a: [{foo: 'bar', '/ts':1}],
				b: [{value:'first', '/ts':200}, {value:'last', '/ts':100}, ],
			}, done);
		});

		it('should retrieve the value of a file', function(done) {
			mfs.get('/hello/a', protect(done, function(err, result) {
				assert.ifError(err);
				assert.equal(result.foo, 'bar');
				done();
			}));
		});
		it('should retrieve the last value in the array, regardless of the /ts value', function(done) {
			mfs.get('/hello/b', protect(done, function(err, result) {
				assert.ifError(err);
				assert.equal(result.value, 'last');
				done();
			}));
		});
	});

	describe('.put(path, file, callback(err))', function() {
		it('should write a file so that get() retrieves it', function(done) {
			mfs.put('/hello/world', {hello: 'world'}, protect(done, function(err) {
				assert.ifError(err);
				mfs.get('/hello/world', protect(done, function(err, file) {
					assert.ifError(err);
					assert.equal(file.hello, 'world', done);
					done();
				}));
			}));
		});
		it('should assign a timestamp to a file if one is not provided', function(done) {
			mfs.put('/hello/file', {key: 123}, protect(done, function(err) {
				assert.ifError(err);
				mfs.get('/hello/file', protect(done, function(err, file) {
					assert.ifError(err);
					var ts = file['/ts'];
					assert(ts, 'file timestamp');
					var now = (new Date()).getTime();
					assert(now > ts, 'now > ts');
					assert(now < ts + 2000, 'now < ts + 2000');
					done();
				}));
			}));
		});
		it('should reflect the provided timestamp if one is given', function(done) {
			mfs.put('/hello/someOtherFile', {foo: 'bar', '/ts': 100}, protect(done, function(err) {
				assert.ifError(err);
				mfs.get('/hello/someOtherFile', protect(done, function(err, file) {
					assert.ifError(err);
					assert.equal(file['/ts'], 100);
					done();
				}));
			}));
		});
	});
	it('should retrieve the value with placed with the highest /ts value', function(done) {
		mfs.put('/some/path/to/doc', {foo: 'bar', '/ts': 1000}, protect(done, function(err) {
			assert.ifError(err);
			mfs.put('/some/path/to/doc', {foo: 'baz', '/ts': 3000}, protect(done, function(err) {
				assert.ifError(err);
				mfs.put('/some/path/to/doc', {foo: 'bat', '/ts': 2000}, protect(done, function(err) {
					assert.ifError(err);
					mfs.get('/some/path/to/doc', protect(done, function(err, file) {
						assert.ifError(err);
						assert.equal(file.foo, 'baz');
						done();
					}));
				}));
			}));
		}));
	});
	describe('.batchPut(keyVals, callback(err))', function() {
		it('should put files for all key/value pairs in the given object', function(done) {
			var valuesToInsert = {'/a/b/c': {foo:'bar'}, '/g/h': {hello: 'world'}, '/tee/pee': {a: 1, b: 2, '/ts': 800}};
			mfs.batchPut(valuesToInsert, protect(done, function(err) {
				assert.ifError(err);
				mfs.get('/a/b/c', protect(done, function(err, file) {
					assert.ifError(err);
					assert.equal(file.foo, 'bar');
					mfs.get('/g/h', protect(done, function(err, file) {
						assert.ifError(err);
						assert.equal(file.hello, 'world');
						mfs.get('/tee/pee', protect(done, function(err, file) {
							assert.ifError(err);
							assert.equal(file.b, 2);
							done();
						}));
					}));
				}));
			}));
		});
	});
	describe('.getDir(path, expandFiles, callback(err, content))', function() {
		before(function(done) {
			mfs.batchPut({'/a/b/c': {a:1}, '/a/b/d': {a:2}, '/a/b/e': {a:3}, '/a/j/k': {a:4}}, done);
		});
		it('should retrieve the names of all files and sub-dirs in the directory', function(done) {
			mfs.getDir('/a/', false, protect(done, function(err, content) {
				assert.ifError(err);
				assert(content.b, 'b');
				assert(content.j, 'j');
				done();
			}));
		});
		it('should retrieve the values of all files in the directory, if expandFiles is set to true', function(done) {
			mfs.getDir('/a/b/', true, protect(done, function(err, content) {
				assert.ifError(err);
				assert.equal(content.c.a, 1);
				assert.equal(content.d.a, 2);
				assert.equal(content.e.a, 3);
				done();
			}));
		});
	});

	describe('.remove(path, timestamp, callback(err))', function(){
		beforeEach(function(done) {
			mfs.put('/file/to/delete', {foo: 'bar', '/ts': 1000}, done);
		});
		afterEach(function(done) {
			coll.update({_id: '/file/to/'}, {$unset: {'delete':0}}, {}, done);
		});
		it('should remove a file of the given path', function(done) {
			mfs.remove('/file/to/delete', 0, protect(done, function(err) {
				assert.ifError(err);
				mfs.get('/file/to/delete', protect(done, function(err, value) {
					assert(err.fileNotFound, 'File should not exist');
					done();
				}));
			}));
		});
		it('sould remove a file only if the removal timestamp is greater than the latest', function(done) {
			mfs.remove('/file/to/delete', 900, protect(done, function(err) {
				assert.ifError(err);
				mfs.get('/file/to/delete', protect(done, function(err, value) {
					assert.ifError(err);
					assert.equal(value.foo, 'bar');
					done();
				}));
			}));			
		});
	});

	describe('.createMapping(path, mapping, callback(err, actions))', function() {
		before(function(done) {
			mfs.batchPut({'/a/b/c': {a:1},'/a/b/d': {a:2},'/a/b/e': {a:3},'/a/b/f/g': {a:4}}, done);
		});
		it('should add an entry in the /map sub-document of the directory', function(done) {
			mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
				assert.ifError(err);
				coll.find({_id: '/a/b/'}).toArray(protect(done, function(err, array) {
					assert.ifError(err);
					assert.equal(array.length, 1);
					assert(array[0]['/map'], 'mapping sub-doc must exist');
					for(var key in array[0]['/map']) {
						// This should be the only one...
						assert.equal(array[0]['/map'][key].map, 123);
					}
					done();
				}));
			}));
		});
		function actionsToMappings(actions) {
			var mappings = {};
			for(var i = 0; i < actions.length; i++) {
				var action = actions[i];
				if(action.type == 'map') {
					mappings[action.path] = action.mapping;
				}
			}
			return mappings;
		}
		it('should emit actions including the mapping for all files in the directory', function(done) {
			mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
				assert.ifError(err);
				var mappings = actionsToMappings(actions);
				assert(mappings['/a/b/c'], 'Valid mapping for /a/b/c');
				assert(mappings['/a/b/d'], 'Valid mapping for /a/b/d');
				assert(mappings['/a/b/e'], 'Valid mapping for /a/b/e');
				done();
			}));
		});
		it.only('should emit actions so that when sending the "tramp" actions back, we get mappings for all files in the sub-tree', function(done) {
			mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
				assert.ifError(err);
				trampoline(mfs, actions, protect(done, function(err, actions) {
					var mappings = actionsToMappings(actions);
					assert(mappings['/a/b/c'], 'Valid mapping for /a/b/c');
					assert(mappings['/a/b/d'], 'Valid mapping for /a/b/d');
					assert(mappings['/a/b/e'], 'Valid mapping for /a/b/e');
					assert(mappings['/a/b/f/g'], 'Valid mapping for /a/b/f/g');
					done();
				}));
			}));
		})
	});
});

