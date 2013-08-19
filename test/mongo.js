var assert = require("assert");
var mongofs = require("../mongofs.js");
var mongodb = require("mongodb");
var util = require("../util.js");
var protect = util.protect;

function trampoline(mfs, actions, callback) {
	for(var i = 0; i < actions.length; i++) {
		var action = actions[i];
		if(action.type == 'tramp') {
			actions.splice(i, 1);
			mfs.trampoline(action, function(err, newActions) {
				if(err) return callback(err);
				actions = actions.concat(newActions);
				trampoline(mfs, actions, callback);
			});
			return;
		}
	}
	// Found no trampoline actions
	callback(undefined, actions);
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
	

	
	/*after(function(done) {
		coll.remove({}, done);
	});*/

	describe('.get(path, callback(err, file))', function() {
		before(function(done) {
			coll.insert({
				_id: '/hello/', 
				f : {
					a: [{foo: 'bar', _ts:1}],
					b: [{value:'first', _ts:200}, {value:'last', _ts:100}, ]
				}
			}, done);
		});

		it('should retrieve the value of a file', function(done) {
			mfs.get('/hello/a', protect(done, function(err, result) {
				assert.equal(result.foo, 'bar');
				done();
			}));
		});
		it('should retrieve the last value in the array, regardless of the _ts value', function(done) {
			mfs.get('/hello/b', protect(done, function(err, result) {
				assert.equal(result.value, 'last');
				done();
			}));
		});
	});

	describe('.put(path, file, callback(err))', function() {
		it('should write a file so that get() retrieves it', function(done) {
			mfs.put('/hello/world', {hello: 'world'}, protect(done, function(err) {
				mfs.get('/hello/world', protect(done, function(err, file) {
					assert.equal(file.hello, 'world', done);
					done();
				}));
			}));
		});
		it('should assign a timestamp to a file if one is not provided', function(done) {
			mfs.put('/hello/file', {key: 123}, protect(done, function(err) {
				mfs.get('/hello/file', protect(done, function(err, file) {
					var ts = file._ts;
					assert(ts, 'file timestamp');
					var now = util.timeUid();
					assert(now > ts, 'now > ts');
					done();
				}));
			}));
		});
		it('should reflect the provided timestamp if one is given', function(done) {
			mfs.put('/hello/someOtherFile', {foo: 'bar', _ts: 100}, protect(done, function(err) {
				mfs.get('/hello/someOtherFile', protect(done, function(err, file) {
					assert.equal(file._ts, 100);
					done();
				}));
			}));
		});
	});
	it('should retrieve the value with the highest _ts value', function(done) {
		util.seq([
			function(_) {mfs.put('/some/path/to/doc', {foo: 'bar', _ts: 1000}, _); },
			function(_) {mfs.put('/some/path/to/doc', {foo: 'baz', _ts: 3000}, _); },
			function(_) {mfs.put('/some/path/to/doc', {foo: 'bat', _ts: 2000}, _); },
			function(_) {
				mfs.get('/some/path/to/doc', protect(done, function(err, file) {
					assert.equal(file.foo, 'baz');
					_();
				}));
			}
		], done)();
	});
	describe('.batchPut(keyVals, callback(err))', function() {
		it('should put files for all key/value pairs in the given object', function(done) {
			var valuesToInsert = {'/a/b/c': {foo:'bar'}, '/g/h': {hello: 'world'}, '/tee/pee': {a: 1, b: 2, _ts: 800}};
			mfs.batchPut(valuesToInsert, protect(done, function(err) {
				mfs.get('/a/b/c', protect(done, function(err, file) {
					assert.equal(file.foo, 'bar');
					mfs.get('/g/h', protect(done, function(err, file) {
						assert.equal(file.hello, 'world');
						mfs.get('/tee/pee', protect(done, function(err, file) {
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
				assert(content['b/'], 'b/');
				assert(content['j/'], 'j/');
				done();
			}));
		});
		it('should retrieve the values of all files in the directory, if expandFiles is set to true', function(done) {
			mfs.getDir('/a/b/', true, protect(done, function(err, content) {
				assert.equal(content.c.a, 1);
				assert.equal(content.d.a, 2);
				assert.equal(content.e.a, 3);
				done();
			}));
		});
	});

	describe('.remove(path, timestamp, callback(err))', function(){
		beforeEach(function(done) {
			mfs.put('/file/to/delete', {foo: 'bar', _ts: 1000}, done);
		});
		afterEach(function(done) {
			coll.update({_id: '/file/to/'}, {$unset: {'f.delete':0}}, {}, done);
		});
		it('should remove a file of the given path', function(done) {
			mfs.remove('/file/to/delete', 0, protect(done, function(err) {
				mfs.get('/file/to/delete', util.shouldFail(done, 'File should not exist', function(err) {
					assert(err.fileNotFound, 'File should not exist');
					done();
				}));
			}));
		});
		it('sould remove a file only if the removal timestamp is greater than the latest', function(done) {
			mfs.remove('/file/to/delete', 900, protect(done, function(err) {
				mfs.get('/file/to/delete', protect(done, function(err, value) {
					assert.equal(value.foo, 'bar');
					done();
				}));
			}));			
		});
	});

	function actionsToMappings(actions) {
		var mappings = {};
		for(var i = 0; i < actions.length; i++) {
			var action = actions[i];
			mappings[action.type + ':' + action.path] = action;
		}
		return mappings;
	}
	describe('.createMapping(path, mapping, callback(err, actions))', function() {
		before(function(done) {
			mfs.batchPut({'/a/b/c': {a:1},'/a/b/d': {a:2},'/a/b/e': {a:3},'/a/b/f/g': {a:4}}, done);
		});
		it('should add an entry in the ".m" sub-document of the directory', function(done) {
			mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
				coll.find({_id: '/a/b/'}).toArray(protect(done, function(err, array) {
					assert.equal(array.length, 1);
					assert(array[0].m, 'mapping sub-doc must exist');
					for(var key in array[0].m) {
						// This should be the only one...
						assert.equal(array[0].m[key].map, 123);
					}
					done();
				}));
			}));
		});
		it('should emit actions including the mapping for all files in the directory', function(done) {
			mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
				var mappings = actionsToMappings(actions);
				assert(mappings['map:/a/b/c'], 'Valid mapping for /a/b/c');
				assert(mappings['map:/a/b/d'], 'Valid mapping for /a/b/d');
				assert(mappings['map:/a/b/e'], 'Valid mapping for /a/b/e');
				done();
			}));
		});
		it('should emit actions so that when sending the "tramp" actions back, we get mappings for all files in the sub-tree', function(done) {
			mfs.createMapping('/a/b/', {map: 123}, protect(done, function(err, actions) {
				trampoline(mfs, actions, protect(done, function(err, actions) {
					var mappings = actionsToMappings(actions);
					assert(mappings['map:/a/b/c'], 'Valid mapping for /a/b/c');
					assert(mappings['map:/a/b/d'], 'Valid mapping for /a/b/d');
					assert(mappings['map:/a/b/e'], 'Valid mapping for /a/b/e');
					assert(mappings['map:/a/b/f/g'], 'Valid mapping for /a/b/f/g');
					done();
				}));
			}));
		});
		it('should work whether or not the directory already exists', function(done) {
			mfs.createMapping('/qwe/rty/', {foo: 'bar'}, protect(done, function(err, actions) {
				mfs.put('/qwe/rty/uio', {baz: 'bat'}, protect(done, function(err, actions2) {
					assert.equal(actions2.length, 1);
					assert.equal(actions2[0].type, 'map');
					assert.equal(actions2[0].mapping.foo, 'bar');
					assert.equal(actions2[0].path, '/qwe/rty/uio');
					done();
				}));
			}));
		});
		describe('with .put()', function() {
			var mappingTS = util.timeUid();
			before(function(done) {
				mfs.createMapping('/a/b/', {map: 333, _ts: mappingTS}, protect(done, function(err, actions) {
					trampoline(mfs, actions, done);
				}));
			});
			after(function(done) {
				mfs.removeMapping('/a/b/', mappingTS, protect(done, function(err, actions) {
					trampoline(mfs, actions, done);
				}));
			});
			it('should cause subsequent calls to .put() emit the mapping for the new object', function(done) {
				mfs.put('/a/b/g', {a:7}, protect(done, function(err, actions) {
					for(var i = 0; i < actions.length; i++) {
						if(actions[i].type == 'map' && 
							actions[i].mapping.map == 333 && 
							actions[i].path == '/a/b/g') {
							return done();
						}
					}
					done(new Error('Could not find action relating to this mapping. Found: ' + JSON.stringify(actions)));
				}));
			});
			it('should cause put() that overrides an existing value provide mapping for the new value and unmapping for the old one', function(done) {
				util.seq([
					function(_) { mfs.put('/x?/y', {value: 'old'}, _); },
					function(_) { mfs.createMapping('/x?/', {map: 1}, _.to('actions')); },
					function(_) { trampoline(mfs, this.actions, _); },
					function(_) { setTimeout(_, 2); },
					function(_) { mfs.put('/x?/y', {value: 'new'}, _.to('actions')); },
					function(_) {
						var mappings = actionsToMappings(this.actions);
						assert(mappings['map:/x?/y'], 'New value mapped');
						assert.equal(mappings['map:/x?/y'].content.value, 'new');
						assert(mappings['unmap:/x?/y'], 'Old value unmapped');
						assert.equal(mappings['unmap:/x?/y'].content.value, 'old');
						_();
					},
				], done)();
			});
		});
		describe('with .remove()', function() {
			var mappingTS = util.timeUid();
			before(function(done) {
				mfs.createMapping('/a/b/', {map: 333, _ts: mappingTS}, protect(done, function(err, actions) {
					trampoline(mfs, actions, done);
				}));
			});
			after(function(done) {
				mfs.removeMapping('/a/b/', mappingTS, protect(done, function(err, actions) {
					trampoline(mfs, actions, done);
				}));
			});

			it('should emit unmapping of the removed content', function(done) {
				mfs.remove('/a/b/c', 0, protect(done, function(err, actions){
					assert(actions.length >= 1, 'there should be at least one unmap');
					for(var i = 0; i < actions.length; i++) {
						assert.equal(actions[i].type, 'unmap');
						assert.equal(actions[i].path, '/a/b/c');
					}
					done();
				}));
			});

		});
	});
	describe('.removeMapping(path, tsid, callback(err, actions))', function() {
		var mapping = {m:1, _ts: util.timeUid()};
		before(function(done) {
			util.seq([
				function(_) { mfs.put('/e/f!/g', {a:1}, _); },
				function(_) { mfs.put('/e/f!/h', {a:2}, _); },
				function(_) { mfs.put('/e/f!/i/j', {a:3}, _); },
				function(_) { mfs.put('/e/f!/i/k', {a:4}, _); },
				function(_) { mfs.createMapping('/e/f!/', mapping, _.to('actions')); },
				function(_) { trampoline(mfs, this.actions, _); },
			], done)();
		})
		it('should remove the mapping with tsid from path, and produce actions to undo its effect', function(done) {
			util.seq([
				function(_) { mfs.removeMapping('/e/f!/', mapping._ts, _.to('actions')); },
				function(_) { trampoline(mfs, this.actions, _.to('actions')); },
				function(_) { 
					var mapping = actionsToMappings(this.actions);
					assert(mapping['unmap:/e/f!/g'], 'unmap:/e/f!/g');
					assert(mapping['unmap:/e/f!/h'], 'unmap:/e/f!/h');
					assert(mapping['unmap:/e/f!/i/j'], 'unmap:/e/f!/i/j');
					assert(mapping['unmap:/e/f!/i/k'], 'unmap:/e/f!/i/k');
					_();
				},
			], done)();
		});
	});
	it('should support any kind of characters in paths, with the exception that slash (/) and star (*)', function(done) {
		var path = '/!@#/$%^/&()/-=+_/,.?<>';
		util.seq([
			function(_) { mfs.put(path, {foo: 'bar'}, _); },
			function(_) { mfs.get(path, _.to('content')); },
			function(_) { assert.equal(this.content.foo, 'bar'); _(); },
		], done)();
	});
	describe('.transaction(trans, callback(err, actions))', function() {
		before(function(done) {
			mfs.batchPut({'/a/b/c': {x:1}, '/a/b/d': {x:2}}, done);
		});
		function actionsToContentMap(results) {
			var contentMap = {}
			for(var i = 0; i < results.length; i++) {
				if(results[i].type == 'content') {
					contentMap[results[i].path] = results[i].content;
				}
			}
			return contentMap;
		}
		it('should allow for multiple get and put operations to be performed atomically', function(done) {
			mfs.transaction({
				path: '/a/b/',
				get: ['c', 'd'],
				put: {c: {x:3}, d: {x:4}}
			}, protect(done, function(err, actions) {
				var contentMap = actionsToContentMap(actions);
				assert.equal(contentMap['/a/b/c'].x, 1);
				assert.equal(contentMap['/a/b/d'].x, 2);
				mfs.transaction({
					path: '/a/b/',
					get: ['c', 'd']
				}, protect(done, function(err, actions) {
					var contentMap = actionsToContentMap(actions);
					assert.equal(contentMap['/a/b/c'].x, 3);
					assert.equal(contentMap['/a/b/d'].x, 4);
					assert.equal(contentMap['/a/b/c']._ts, contentMap['/a/b/d']._ts);
					done();
				}));
			}));
		});
	});
});

