var MatchMaker = require('../matchMaker.js').MatchMaker;
var MFS = require('../mongofs.js').MFS;
var util = require('../util.js');
var assert = require('assert');

describe('MatchMaker', function() {
    var storage;
    var coll;
    var mm;
    before(function(done) {
        require('mongodb').MongoClient.connect('mongodb://127.0.0.1:27017/test', function(err, db) {
            if(err) return done(err);
            coll = db.collection('test');
            storage = new MFS(coll, {maxVers: 2});
            mm = new MatchMaker(storage);
	    done();
        });
    });
    beforeEach(function(done) {
        coll.remove({}, done);
    });
    it('should proxy transactions to the underlying storage', function(done) {
	util.seq([
	    function(_) { mm.transaction({path: '/a/b/', put:{'c.json':{x:1}}}, _); },
	    function(_) { storage.transaction({path: '/a/b/', get:['*']}, _.to('result')); },
	    function(_) {
		assert(this.result['c.json'], 'c.json should exist in storage');
		assert.equal(this.result['c.json'].x, 1);
		_();
	    },
	], done)();
    });
    describe('put', function() {
	it('should add a _map entry to the result, containing a list of mappings', function(done) {
	    util.seq([
		// Adding a .map file to a directory, directly in storage.
		function(_) { storage.transaction({path: '/a/b/', put: {'foo.map': {m:1}}, _ts: '0100'}, _); },
		// Adding a .json file and collecing the result
		function(_) { mm.transaction({path: '/a/b/', put: {'bar.json': {x:1}}, _ts: '0101'}, _.to('result')); },
		function(_) {
		    assert(this.result._map, 'A _map entry should be added to the result');
		    assert(Array.isArray(this.result._map), 'it should be an array');
		    assert.equal(this.result._map.length, 1, 'it should have one entry');
		    assert.equal(this.result._map[0].path, '/a/b/bar.json', 'it should indicate the path of the .json file');
		    assert.deepEqual(this.result._map[0].content, {x:1, _ts: '0101'}, 'it should have the content of the .json file');
		    assert.deepEqual(this.result._map[0].map, {m:1, _ts: '0100'}, 'and the .map file');
		    _();
		},
	    ], done)();
	});
	it('should add a mapping entry for each .map file in the directory when adding a .json file', function(done) {
	    util.seq([
		// Adding three .map file to a directory, directly in storage.
		function(_) { storage.transaction({path: '/a/b/', put: {'1.map': {m:1}, '2.map': {m:2}, '3.map': {m:3}}, _ts: '0100'}, _); },
		// Adding a .json file and collecing the result
		function(_) { mm.transaction({path: '/a/b/', put: {'x.json': {x:1}}, _ts: '0101'}, _.to('result')); },
		function(_) {
		    assert.deepEqual(this.result._map, [
			{path: '/a/b/x.json', content: {x:1, _ts: '0101'}, map: {m:1, _ts: '0100'}},
			{path: '/a/b/x.json', content: {x:1, _ts: '0101'}, map: {m:2, _ts: '0100'}},
			{path: '/a/b/x.json', content: {x:1, _ts: '0101'}, map: {m:3, _ts: '0100'}},
		    ]);
		    _();
		},
	    ], done)();
	});
	it('should add a mapping entry for each .json file in the directory when adding a .map file', function(done) {
	    util.seq([
		// Adding three .json files directly in the storage
		function(_) { storage.transaction({path: '/a/b/', put: {'1.json': {x:1}, '2.json': {x:2}, '3.json': {x:3}}, _ts: '0100'}, _); },
		// Adding a .map file and collecing the result
		function(_) { mm.transaction({path: '/a/b/', put: {'m..map': {m:1}}, _ts: '0101'}, _.to('result')); },
		function(_) {
		    assert.deepEqual(this.result._map, [
			{path: '/a/b/1.json', content: {x:1, _ts: '0100'}, map: {m:1, _ts: '0101'}},
			{path: '/a/b/2.json', content: {x:2, _ts: '0100'}, map: {m:1, _ts: '0101'}},
			{path: '/a/b/3.json', content: {x:3, _ts: '0100'}, map: {m:1, _ts: '0101'}},
		    ]);
		    _();
		},
	    ], done)();
	});
	it.skip('should create a _tramp entry in the result with entries for each subdirectory, to propagate .map files', function(done) {
	    
	});
    });
});