
const EventEmitter = require('events').EventEmitter,
    dirname = require('path').dirname,
    resolve = require('path').resolve,
    fs = require('fs'),
    fsPromises = fs.promises,
    Q = require('q')

const DEBUG = !!process.env.ARCHITECT_DEBUG

function A() {
    var self = this
    // Only define Node-style usage using sync I/O if in node.
    var packagePathCache = {};
    var basePath;

    self.loadConfig = loadConfig;
    self.loadLoadedConfig = loadLoadedConfig;
    self.resolveConfig = resolveConfig;

    // This is assumed to be used at startup and uses sync I/O as well as can
    // throw exceptions.  It loads and parses a config file.
    function loadConfig(configPath) {
        var config = require(configPath);
        var base = dirname(configPath);

        return resolveConfig(config, base);
    }

    //THis function is uses a preimported config file for use with a minifier.
    function loadLoadedConfig(configJS, pluginJSON, pluginJS) {
        return resolveLoadedConfig(configJS.slice(0), pluginJSON, pluginJS);
    }

    function resolveLoadedConfig(config, packages, scripts) {
        config.forEach(function (plugin, index) {
            //Objectify strings
            if (typeof plugin === "string") {
                plugin = config[index] = { packagePath: plugin };
            }
            //Process plugins
            if (plugin.hasOwnProperty("packagePath") && !plugin.hasOwnProperty("setup")) {
                var defaults;

                defaults = resolveLoadedPackage(plugin.packagePath, packages)["plugin"];
                Object.keys(defaults).forEach(function (key) {
                    if (!plugin.hasOwnProperty(key)) {
                        plugin[key] = defaults[key];
                    }
                });
                plugin.setup = resolveLoadedScript(plugin.packagePath, scripts);
            }
        });
        return config;
    }
    //Use only for importing loaded package.jsons
    function resolveLoadedPackage(modulePath, packages) {
        var mod = modulePath.split('/');
        mod = mod[mod.length - 1];
        var ret;
        Object.keys(packages.plugins).forEach(function (key) {
            if (key === mod) {
                ret = packages.plugins[mod].package;
                return;
            }
        });
        if (ret)
            return ret;
        else
            Object.keys(packages.plugins.sdk).forEach(function (key) {
                if (key === mod) {
                    ret = packages.plugins.sdk[mod].package;
                    return;
                }
            });
        if (ret)
            return ret;
        else
            throw new Error("Package " + mod + " Does Not Exist!");
    }
    //Use for importing loaded plugin Scripts
    function resolveLoadedScript(modulePath, script) {
        var mod = modulePath.split('/');
        mod = mod[mod.length - 1];
        var ret;
        Object.keys(script.plugins).forEach(function (key) {
            if (key === mod) {
                ret = script.plugins[mod][mod];
                return;
            }
        });
        if (ret)
            return ret;
        else
            Object.keys(script.plugins.sdk).forEach(function (key) {
                if (key === mod) {
                    ret = script.plugins.sdk[mod][mod];
                    return;
                }
            });
        if (ret)
            return ret;
        else
            throw new Error("Package " + mod + " Does Not Exsist!");
    }

    async function resolveConfig(config, base) {
        if (!base) base = basePath
        async function resolveNext(i) {
            if (i >= config.length) {
                return config
            }

            var plugin = config[i];

            // Shortcut where string is used for plugin without any options.
            if (typeof plugin === "string") {
                plugin = config[i] = { packagePath: plugin };
            }
            // The plugin is a package on the disk.  We need to load it.
            if (plugin.hasOwnProperty("packagePath") && !plugin.hasOwnProperty("setup")) {
                const defaults = await resolveModule(base, plugin.packagePath);
                Object.keys(defaults).forEach(function (key) {
                    if (!plugin.hasOwnProperty(key)) {
                        plugin[key] = defaults[key];
                    }
                });
                plugin.packagePath = defaults.packagePath;

                plugin.setup = require(plugin.packagePath);
                return await resolveNext(++i);
            }

            return await resolveNext(++i);
        }

        return await resolveNext(0);
    }

    // Loads a module, getting metadata from either it's package.json or export
    // object.
    async function resolveModule(base, modulePath) {
        let packagePath
        try {
            packagePath = await resolvePackage(base, modulePath + "/package.json")
        } catch (ex) { }

        var metadata = packagePath && require(packagePath).plugin || {};

        if (packagePath) {
            modulePath = dirname(packagePath)
        }
        else {
            modulePath = await resolvePackage(base, modulePath);
        }
        var mod = require(modulePath);

        metadata.provides = metadata.provides || mod.provides || [];
        metadata.consumes = metadata.consumes || mod.consumes || [];
        metadata.packagePath = modulePath;
        return metadata
    }


    async function resolvePackage(base, packagePath) {
        var originalBase = base;
        if (!packagePathCache.hasOwnProperty(base)) {
            packagePathCache[base] = {};
        }
        var cache = packagePathCache[base];
        if (cache.hasOwnProperty(packagePath)) {
            return cache[packagePath];
        }
        if (packagePath[0] === "." || packagePath[0] === "/") {
            var newPath = resolve(base, packagePath);
            return await done(newPath)
        }
        else {
            await tryNext(base);
        }

        async function done(newPath) {
            newPath = await fsPromises.realpath(newPath)

            cache[packagePath] = newPath;
            return newPath
        }

        async function tryNext(base) {
            if (base == "/") {
                var err = new Error("Can't find '" + packagePath + "' relative to '" + originalBase + "'");
                err.code = "ENOENT";
                throw err
            }

            var newPath = resolve(base, "node_modules", packagePath);
            if (await fsPromises.access(newPath, fs.constants.R_OK)) {
                return await done(newPath)
            } else {
                var nextBase = resolve(base, '..');
                if (nextBase === base)
                    await tryNext("/"); // for windows
                else
                    await tryNext(nextBase);
            }
        }
    }

    self.Architect = Architect;

    // Check a plugin config list for bad dependencies and throw on error
    function checkConfig(config, lookup) {

        // Check for the required fields in each plugin.
        config.forEach(function (plugin) {
            if (plugin.checked) { return; }
            if (!plugin.hasOwnProperty("setup")) {
                throw new Error("Plugin is missing the setup function " + JSON.stringify(plugin));
            }
            if (!plugin.hasOwnProperty("provides")) {
                throw new Error("Plugin is missing the provides array " + JSON.stringify(plugin));
            }
            if (!plugin.hasOwnProperty("consumes")) {
                throw new Error("Plugin is missing the consumes array " + JSON.stringify(plugin));
            }
        });

        return checkCycles(config, lookup);
    }

    function checkCycles(config, lookup) {
        var plugins = [];
        config.forEach(function (pluginConfig, index) {
            plugins.push({
                packagePath: pluginConfig.packagePath,
                provides: pluginConfig.provides.concat(),
                consumes: pluginConfig.consumes.concat(),
                i: index
            });
        });

        var resolved = {
            hub: true,
            this: true
        };
        var changed = true;
        var sorted = [];

        while (plugins.length && changed) {
            changed = false;

            plugins.concat().forEach(function (plugin) {
                var consumes = plugin.consumes.concat();

                var resolvedAll = true;
                for (var i = 0; i < consumes.length; i++) {
                    var service = consumes[i];
                    if (!resolved[service] && (!lookup || !lookup(service))) {
                        resolvedAll = false;
                    } else {
                        plugin.consumes.splice(plugin.consumes.indexOf(service), 1);
                    }
                }

                if (!resolvedAll)
                    return;

                plugins.splice(plugins.indexOf(plugin), 1);
                plugin.provides.forEach(function (service) {
                    resolved[service] = true;
                });
                sorted.push(config[plugin.i]);
                changed = true;
            });
        }

        if (plugins.length) {
            var unresolved = {};
            plugins.forEach(function (plugin) {
                delete plugin.config;
                plugin.consumes.forEach(function (name) {
                    if (unresolved[name] === false)
                        return;
                    if (!unresolved[name])
                        unresolved[name] = [];
                    unresolved[name].push(plugin.packagePath);
                });
                plugin.provides.forEach(function (name) {
                    unresolved[name] = false;
                });
            });

            Object.keys(unresolved).forEach(function (name) {
                if (unresolved[name] === false)
                    delete unresolved[name];
            });

            var unresolvedList = Object.keys(unresolved);
            var resolvedList = Object.keys(resolved);
            var err = new Error("Could not resolve dependencies\n"
                + (unresolvedList.length ? "Missing services: " + unresolvedList
                    : "Config contains cyclic dependencies" // TODO print cycles
                ));
            err.unresolved = unresolvedList;
            err.resolved = resolvedList;
            throw err;
        }

        return sorted;
    }

    function Architect(config) {
        var app = this;
        app.config = config;
        app.packages = {};
        app.pluginToPackage = {};

        var isAdditionalMode;
        var services = app.services = {
            hub: {
                on: function (name, callback) {
                    app.on(name, callback);
                }
            }
        };

        // Check the config
        var sortedPlugins = checkConfig(config);

        var destructors = [];
        var recur = 0, callnext, ready;
        async function startPlugins(additional) {
            var plugin = sortedPlugins.shift();

            //Ready when there are no more plugin
            if (!plugin) {
                ready = true;
                return app.emit(additional ? "ready-additional" : "ready", app);
            }

            var imports = {};
            if (plugin.consumes) {
                plugin.consumes.forEach(function (name) {
                    if (name == "this") imports["this"] = self
                    else imports[name] = services[name];
                });
            }

            var packageName = plugin.packageName
            if (!packageName) {
                packageName = plugin.packageName = "__" + Object.keys(app.packages).length
            }

            if(app.packages[packageName]){
                const e = new Error("Unable to start "+packageName+" as already started")
                app.emit("error", e);
                throw e;
            }

            try {
                recur++;
                try {
                    await plugin.setup(plugin, imports, register);
                } catch (ex) {
                    delete app.packages[packageName]
                    throw ex
                }
            } catch (e) {
                e.plugin = plugin;
                app.emit("error", e);
                throw e;
            } finally {
                while (callnext && recur <= 1) {
                    callnext = false;
                    await startPlugins(additional);
                }
                recur--;
            }

            async function register(err, provided) {

                if (err) { return app.emit("error", err); }
                plugin.provides.forEach(function (name) {
                    if (!provided.hasOwnProperty(name)) {
                        var err = new Error("Plugin failed to provide " + name + " service. " + JSON.stringify(plugin));
                        err.plugin = plugin;
                        return app.emit("error", err);
                    }
                    services[name] = provided[name];
                    app.pluginToPackage[name] = {
                        plugin: plugin,
                        path: plugin.packagePath,
                        package: packageName,
                        version: plugin.version,
                        isAdditionalMode: isAdditionalMode
                    };
                    app.packages[packageName].push(name);

                    app.emit("service", name, services[name], plugin);
                });
                if (provided && provided.hasOwnProperty("onDestroy"))
                    destructors.push(provided.onDestroy);

                plugin.destroy = async function () {
                    if (plugin.provides.length) {
                        // Assumes all consumers are done
                        plugin.provides.forEach(function (name) {
                            delete services[name];
                            delete app.pluginToPackage[name];
                        });
                        delete app.packages[packageName];
                    }

                    app.emit("destroying", plugin);
                    try {
                        if (provided && provided.hasOwnProperty("onDestroy")) {
                            destructors.splice(destructors.indexOf(provided.onDestroy), 1);
                            await provided.onDestroy();
                        }
                    } finally {
                        // delete from config
                        app.config.splice(app.config.indexOf(plugin), 1);
                        app.emit("destroyed", plugin);
                    }
                };

                app.emit("plugin", plugin);

                if (recur) return (callnext = true);
                await startPlugins(additional);
            }
        }

        this.startPlugins = startPlugins

        this.loadAdditionalPlugins = async function (additionalConfig) {
            isAdditionalMode = true;

            additionalConfig = await self.resolveConfig(additionalConfig)

            // Check the config - hopefully this works
            var _sortedPlugins = checkConfig(additionalConfig, function (name) {
                if (name == "this") return true
                return services[name];
            });

            //Must be ready to continue
            if(!ready){
                const readyWait = Q.defer()
                app.once('ready', function(){
                    readyWait.resolve()
                })
                await readyWait.promise
            }

            // TODO: What about error state?
            const deferred = Q.defer()
            app.once("ready-additional", function (app) {
                deferred.resolve(app)
            }); 

            // Start Loading additional plugins
            sortedPlugins = _sortedPlugins;
            await startPlugins(true);
            _sortedPlugins = null

            return await deferred.promise
        }


        this.destroy = async function () {
            function canDestroy(plugin) {
                for (var f in app.pluginToPackage) {
                    const pluginToPackage = app.pluginToPackage[f].plugin
                    for (var provides in plugin.provides) {
                        if (pluginToPackage.consumes.includes(plugin.provides[provides])) {
                            return false
                        }
                    }
                }
                return true
            }

            let destroyed
            do {
                destroyed = 0
                for (var i in app.pluginToPackage) {
                    const plugin = app.pluginToPackage[i].plugin
                    if (canDestroy(plugin)) {
                        destroyed++
                        await plugin.destroy()
                    }
                }
            } while (destroyed)

            if (Object.keys(app.pluginToPackage).length) {
                throw new Error("Unable to destroy all plugins")
            }
        }
    }
    Architect.prototype = Object.create(EventEmitter.prototype, { constructor: { value: Architect } });

    Architect.prototype.getService = function (name) {
        if (name == "this") return self
        if (!this.services[name]) {
            throw new Error("Service '" + name + "' not found in architect app!");
        }
        return this.services[name];
    }

    this.Instance = Architect
}
module.exports = A
