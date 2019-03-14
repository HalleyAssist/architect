const Architect = require("./architect");
const test = require("tape-async");
const fs = require("fs");
const promisify = require("util").promisify;
const path = require("path");

const readFile = promisify(fs.readFile);
const unlink = promisify(fs.unlink);
const writeFile = promisify(fs.writeFile);
const mkdirp = promisify(require("mkdirp"));
const Q = require('q')

test("resolve config resolved", async assert => {
    const config = [{
        setup: function() {
            // noop
        },
        provides: ["foo"],
        consumes: ["foo"]
    }];

    var architect = new Architect()
    const resolvedConfig = await architect.resolveConfig(config, "")

    assert.deepEqual(resolvedConfig, config);
});
/*
test("resolve config from basepath + node_modules", async(assert) => {
    const fakePlugin = `
        module.exports = {
            setup: function(){
                // noop
            },
            provides: ["foo"],
            consumes: ["foo"]
        }
    `;

    let packagePath = "_fake/plugin_" + Date.now()+ ".js";
    let packageDir = "/tmp/_architect_test_fixtures/node_modules";
    let fullPath = packageDir + "/" + packagePath ;

    let config = [
        packagePath,
    ];

    await mkdirp(path.dirname(fullPath));
    await writeFile(fullPath, fakePlugin.toString());

    var architect = new Architect()
    const resolvedConfig = await architect.resolveConfig(config, path.dirname(packageDir))
    
    assert.equal(resolvedConfig[0].packagePath, fullPath);
    assert.deepEqual(resolvedConfig[0].consumes, ["foo"]);
    assert.deepEqual(resolvedConfig[0].provides, ["foo"]);

    await unlink(fullPath);
});

test("resolve config from basepath + node_modules, async", async(assert) => {
    const fakePlugin = `
        module.exports = {
            setup: function(){
                // noop
            },
            provides: ["foo"],
            consumes: ["foo"]
        }
    `;

    let packagePath = "_fake/plugin_" + Date.now();
    let packageDir = "/tmp/_architect_test_fixtures/node_modules";
    let fullPath = packageDir + "/" + packagePath + ".js";

    let config = [
        packagePath,
    ];

    await mkdirp(path.dirname(fullPath));
    await writeFile(fullPath, fakePlugin.toString());

    var architect = new Architect()
    let resolvedConfig = await architect.resolveConfig(config, path.dirname(packageDir));

    assert.equal(resolvedConfig[0].packagePath, fullPath);
    assert.deepEqual(resolvedConfig[0].consumes, ["foo"]);
    assert.deepEqual(resolvedConfig[0].provides, ["foo"]);

    await unlink(fullPath);
    assert.end();
});
*/

test("it should start an architect app (classic)", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                await register(null);
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async function(config, imports, register) {
                await register(null, {
                    "bar.plugin": {
                        iamBar: true
                    }
                });
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    var instance = new architect.Instance(fakeConfig)
    await instance.startPlugins()
});

test("it should provide imports", async(assert) => {
    let iamBar = false;

    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                assert.ok(imports["bar.plugin"].iamBar);
                iamBar = true;
                await register();
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async function(config, imports, register) {
                await register(null, {
                    "bar.plugin": {
                        iamBar: true
                    }
                });
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    
    var instance = new architect.Instance(fakeConfig)
    await instance.startPlugins()
    assert.ok(iamBar, "iamBar was imported");
});

test("it should destroy imports", async(assert) => {
    let barDestroyed = false;

    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                assert.ok(imports["bar.plugin"].iamBar);
                await register();
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async function(config, imports, register) {
                await register(null, {
                    onDestroy: function() {
                        barDestroyed = true;
                    },
                    "bar.plugin": {
                        iamBar: true
                    }
                });
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()

    
    var instance = new architect.Instance(fakeConfig)
    await instance.startPlugins()
    await instance.destroy();
    assert.ok(barDestroyed, "barDestroyed");
});

test("destroy should wait on async", async(assert) => {
    let barDestroyed = false;

    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                assert.ok(imports["bar.plugin"].iamBar);
                await register();
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async function(config, imports, register) {
                await register(null, {
                    onDestroy: async function() {
                        await Q.delay(100)
                        barDestroyed = true;
                    },
                    "bar.plugin": {
                        iamBar: true
                    }
                });
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()

    
    var instance = new architect.Instance(fakeConfig)
    await instance.startPlugins()
    await instance.destroy();
    assert.ok(barDestroyed, "barDestroyed");
});


test("it allow loading additionalPlugins", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                assert.ok(imports["bar.plugin"].iamBar);
                await register();
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async function(config, imports, register) {
                await register(null, {
                    "bar.plugin": {
                        iamBar: true
                    }
                });
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    var instance = new architect.Instance(fakeConfig)

    const deferred = Q.defer()
    instance.on("ready", async () => {
        try {
            let loadedBar = false;

            const fakeAdditional = [{
                packagePath: "biz/plugin",
                setup: async function(config, imports, register) {
                    assert.ok(imports["bar.plugin"].iamBar);
                    loadedBar = true;
                    await register();
                },
                provides: [],
                consumes: ["bar.plugin"]
            }];

            await instance.loadAdditionalPlugins(fakeAdditional);

            assert.ok(loadedBar, "loadedBar");
            deferred.resolve()
        } catch(ex){
            deferred.reject(ex)
        }
    });

    await instance.startPlugins()
    await deferred.promise
});

test("it detects cyclic dependencies (classic)", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {},
            provides: ["foo.plugin"],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async function(config, imports, register) {},
            provides: ["bar.plugin"],
            consumes: ["foo.plugin"]
        }
    ];

    var architect = new Architect()

    let err
    try {
        var instance = new architect.Instance(fakeConfig)
        await instance.startPlugins()
    } catch(ex){
        err = ex
    }

    assert.ok(err, 'expected error')
    assert.ok(err.message.includes('Could not resolve dependencies'));
});

test("it checks the provides", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                await register(null);
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async function(config, imports, register) {
                await register(null, {});
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    let err
    try {
        var instance = new architect.Instance(fakeConfig)
        await instance.startPlugins()
    } catch(ex){
        err = ex
    }

    assert.ok(err, 'expected error')
    if(err) assert.ok(/Plugin failed to provide bar.plugin service/.test(err.message));
});

test("it checks all dependencies", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {},
            provides: ["foo.plugin"],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async function(config, imports, register) {},
            provides: [],
            consumes: []
        }
    ];

    var architect = new Architect()
    let err
    try {
        var instance = new architect.Instance(fakeConfig)
        await instance.startPlugins()
    } catch(ex){
        err = ex
    }

    let expect = "Could not resolve dependencies\nMissing services: bar.plugin";
    assert.ok(err, 'expected error')
    assert.equal(err.message, expect);
});

test("it validates config (consumes must be present)", async(assert) => {
    const fakeConfig = [{
        packagePath: "foo/plugin",
        setup: async function(config, imports, register) {},
        provides: [],
    }];

    var architect = new Architect()
    let err
    try {
        var instance = new architect.Instance(fakeConfig)
        await instance.startPlugins()
    } catch(ex){
        err = ex
    }

    assert.ok(err, 'expected error')
    assert.ok(/Plugin is missing the consumes array/.test(err.message));
});

test("it validates config (provides must be present)", async(assert) => {
    const fakeConfig = [{
        packagePath: "foo/plugin",
        setup: async function(config, imports, register) {},
    }];


    var architect = new Architect()
    let err
    try {
        var instance = new architect.Instance(fakeConfig)
        await instance.startPlugins()
    } catch(ex){
        err = ex
    }

    assert.ok(err, 'expected error')
    assert.ok(/Plugin is missing the provides array/.test(err.message));
});

test("it validates config (setup must be present)", async(assert) => {
    const fakeConfig = [{
        packagePath: "foo/plugin",
    }];


    var architect = new Architect()
    let err
    try {
        var instance = new architect.Instance(fakeConfig)
        await instance.startPlugins()
    } catch(ex){
        err = ex
    }

    assert.ok(err, 'expected error')
    assert.ok(/Plugin is missing the setup function/.test(err.message));
});

test("it should start an architect app when plugin _returns_ value", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                await register(null);
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: function(config, imports) {
                return {
                    "bar.plugin": {
                        isBar: true
                    }
                };
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    var instance = new architect.Instance(fakeConfig)
    await instance.startPlugins()
});

test("it should start an architect app when plugin awaits", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                await register(null);
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async(config, imports) => {
                let delay = new Promise(resolve => {
                    setTimeout(resolve, 100);
                });

                await delay;

                return {
                    "bar.plugin": {
                        isBar: true
                    }
                };
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    var instance = new architect.Instance(fakeConfig)
    await instance.startPlugins()
});

test("it should start an architect app when plugin returns promise", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                await register(null);
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async(config, imports) => {
                return new Promise(resolve => {
                    resolve({
                        "bar.plugin": {
                            isBar: true
                        }
                    });
                });
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    var instance = new architect.Instance(fakeConfig)
    await instance.startPlugins()
});

test("it should start an architect app when plugin rejects promise", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                await register(null);
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async(config, imports) => {
                return new Promise((resolve, reject) => {
                    reject("Foo error!");
                });
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    let err
    try {
        var instance = new architect.Instance(fakeConfig)
        await instance.startPlugins()
    } catch(ex){
        err = ex
    }

    assert.ok(err, 'expected error')
    assert.ok(err.message.includes("Foo error!"), 'err should contain Foo error');
});

test("it should start an architect app when plugin has an error", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                await register(null);
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async(config, imports) => {
                let boink = 1;
                boink();
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    let err
    try {
        var instance = new architect.Instance(fakeConfig)
        await instance.startPlugins()
    } catch(ex){
        err = ex
    }

    assert.ok(err, 'expected error')
    assert.equal(err.message, "boink is not a function");
});

test("it should start an architect app with await", async(assert) => {
    const fakeConfig = [{
            packagePath: "foo/plugin",
            setup: async function(config, imports, register) {
                await register(null);
            },
            provides: [],
            consumes: ["bar.plugin"]
        },
        {
            packagePath: "bar/plugin",
            setup: async(config, imports, register) => {
                await register(null, {
                    "bar.plugin": {
                        isBar: true
                    }
                });
            },
            provides: ["bar.plugin"],
            consumes: []
        }
    ];

    var architect = new Architect()
    const app = new architect.Instance(fakeConfig);

    await app.startPlugins()

    let service = app.getService("bar.plugin");

    assert.deepEqual(service, { isBar: true });

});