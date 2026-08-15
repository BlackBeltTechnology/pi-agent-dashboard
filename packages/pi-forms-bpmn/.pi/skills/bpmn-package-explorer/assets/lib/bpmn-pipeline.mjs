// node_modules/min-dash/dist/index.js
var nativeToString = Object.prototype.toString;
var nativeHasOwnProperty = Object.prototype.hasOwnProperty;
function isUndefined(obj) {
  return obj === void 0;
}
function isDefined(obj) {
  return obj !== void 0;
}
function isNil(obj) {
  return obj == null;
}
function isArray(obj) {
  return nativeToString.call(obj) === "[object Array]";
}
function isObject(obj) {
  return nativeToString.call(obj) === "[object Object]";
}
function isFunction(obj) {
  const tag = nativeToString.call(obj);
  return tag === "[object Function]" || tag === "[object AsyncFunction]" || tag === "[object GeneratorFunction]" || tag === "[object AsyncGeneratorFunction]" || tag === "[object Proxy]";
}
function isString(obj) {
  return nativeToString.call(obj) === "[object String]";
}
function has(target, key) {
  return !isNil(target) && nativeHasOwnProperty.call(target, key);
}
function find(collection, matcher) {
  const matchFn = toMatcher(matcher);
  let match;
  forEach(collection, function(val, key) {
    if (matchFn(val, key)) {
      match = val;
      return false;
    }
  });
  return match;
}
function findIndex(collection, matcher) {
  const matchFn = toMatcher(matcher);
  let idx = isArray(collection) ? -1 : void 0;
  forEach(collection, function(val, key) {
    if (matchFn(val, key)) {
      idx = key;
      return false;
    }
  });
  return idx;
}
function filter(collection, matcher) {
  const matchFn = toMatcher(matcher);
  let result = [];
  forEach(collection, function(val, key) {
    if (matchFn(val, key)) {
      result.push(val);
    }
  });
  return result;
}
function forEach(collection, iterator) {
  let val, result;
  if (isUndefined(collection)) {
    return;
  }
  const convertKey = isArray(collection) ? toNum : identity;
  for (let key in collection) {
    if (has(collection, key)) {
      val = collection[key];
      result = iterator(val, convertKey(key));
      if (result === false) {
        return val;
      }
    }
  }
}
function map(collection, fn) {
  let result = [];
  forEach(collection, function(val, key) {
    result.push(fn(val, key));
  });
  return result;
}
function toMatcher(matcher) {
  return isFunction(matcher) ? matcher : (e) => {
    return e === matcher;
  };
}
function identity(arg) {
  return arg;
}
function toNum(arg) {
  return Number(arg);
}
function bind(fn, target) {
  return fn.bind(target);
}
function assign(target, ...others) {
  return Object.assign(target, ...others);
}
function set(target, path, value) {
  let currentTarget = target;
  forEach(path, function(key, idx) {
    if (typeof key !== "number" && typeof key !== "string") {
      throw new Error("illegal key type: " + typeof key + ". Key should be of type number or string.");
    }
    if (key === "constructor") {
      throw new Error("illegal key: constructor");
    }
    if (key === "__proto__") {
      throw new Error("illegal key: __proto__");
    }
    let nextKey = path[idx + 1];
    let nextTarget = currentTarget[key];
    if (isDefined(nextKey) && isNil(nextTarget)) {
      nextTarget = currentTarget[key] = isNaN(+nextKey) ? {} : [];
    }
    if (isUndefined(nextKey)) {
      if (isUndefined(value)) {
        delete currentTarget[key];
      } else {
        currentTarget[key] = value;
      }
    } else {
      currentTarget = nextTarget;
    }
  });
  return target;
}
function pick(target, properties) {
  let result = {};
  let obj = Object(target);
  forEach(properties, function(prop) {
    if (prop in obj) {
      result[prop] = target[prop];
    }
  });
  return result;
}

// node_modules/moddle/dist/index.js
function Base() {
}
Base.prototype.get = function(name2) {
  return this.$model.properties.get(this, name2);
};
Base.prototype.set = function(name2, value) {
  this.$model.properties.set(this, name2, value);
};
function Factory(model, properties) {
  this.model = model;
  this.properties = properties;
}
Factory.prototype.createType = function(descriptor) {
  var model = this.model;
  var props = this.properties, prototype = Object.create(Base.prototype);
  forEach(descriptor.properties, function(p) {
    if (!p.isMany && p.default !== void 0) {
      prototype[p.name] = p.default;
    }
  });
  props.defineModel(prototype, model);
  props.defineDescriptor(prototype, descriptor);
  var name2 = descriptor.ns.name;
  function ModdleElement(attrs) {
    props.define(this, "$type", { value: name2, enumerable: true });
    props.define(this, "$attrs", { value: {} });
    props.define(this, "$parent", { writable: true });
    forEach(attrs, bind(function(val, key) {
      this.set(key, val);
    }, this));
  }
  ModdleElement.prototype = prototype;
  ModdleElement.hasType = prototype.$instanceOf = this.model.hasType;
  props.defineModel(ModdleElement, model);
  props.defineDescriptor(ModdleElement, descriptor);
  return ModdleElement;
};
var BUILTINS = assign(/* @__PURE__ */ Object.create(null), {
  String: true,
  Boolean: true,
  Integer: true,
  Real: true,
  Element: true
});
var TYPE_CONVERTERS = assign(/* @__PURE__ */ Object.create(null), {
  String: function(s) {
    return s;
  },
  Boolean: function(s) {
    return s === "true";
  },
  Integer: function(s) {
    return parseInt(s, 10);
  },
  Real: function(s) {
    return parseFloat(s);
  }
});
function coerceType(type, value) {
  var converter = TYPE_CONVERTERS[type];
  if (converter) {
    return converter(value);
  } else {
    return value;
  }
}
function isBuiltIn(type) {
  return !!BUILTINS[type];
}
function isSimple(type) {
  return !!TYPE_CONVERTERS[type];
}
function parseName(name2, defaultPrefix) {
  var parts = name2.split(/:/), localName, prefix2;
  if (parts.length === 1) {
    localName = name2;
    prefix2 = defaultPrefix;
  } else if (parts.length === 2) {
    localName = parts[1];
    prefix2 = parts[0];
  } else {
    throw new Error("expected <prefix:localName> or <localName>, got " + name2);
  }
  name2 = (prefix2 ? prefix2 + ":" : "") + localName;
  return {
    name: name2,
    prefix: prefix2,
    localName
  };
}
function DescriptorBuilder(nameNs) {
  this.ns = nameNs;
  this.name = nameNs.name;
  this.allTypes = [];
  this.allTypesByName = /* @__PURE__ */ Object.create(null);
  this.properties = [];
  this.propertiesByName = /* @__PURE__ */ Object.create(null);
}
DescriptorBuilder.prototype.build = function() {
  return pick(this, [
    "ns",
    "name",
    "allTypes",
    "allTypesByName",
    "properties",
    "propertiesByName",
    "bodyProperty",
    "idProperty"
  ]);
};
DescriptorBuilder.prototype.addProperty = function(p, idx, validate) {
  if (typeof idx === "boolean") {
    validate = idx;
    idx = void 0;
  }
  this.addNamedProperty(p, validate !== false);
  var properties = this.properties;
  if (idx !== void 0) {
    properties.splice(idx, 0, p);
  } else {
    properties.push(p);
  }
};
DescriptorBuilder.prototype.replaceProperty = function(oldProperty, newProperty, replace) {
  var oldNameNs = oldProperty.ns;
  var props = this.properties, propertiesByName = this.propertiesByName, rename = oldProperty.name !== newProperty.name;
  if (oldProperty.isId) {
    if (!newProperty.isId) {
      throw new Error(
        "property <" + newProperty.ns.name + "> must be id property to refine <" + oldProperty.ns.name + ">"
      );
    }
    this.setIdProperty(newProperty, false);
  }
  if (oldProperty.isBody) {
    if (!newProperty.isBody) {
      throw new Error(
        "property <" + newProperty.ns.name + "> must be body property to refine <" + oldProperty.ns.name + ">"
      );
    }
    this.setBodyProperty(newProperty, false);
  }
  var idx = props.indexOf(oldProperty);
  if (idx === -1) {
    throw new Error("property <" + oldNameNs.name + "> not found in property list");
  }
  props.splice(idx, 1);
  this.addProperty(newProperty, replace ? void 0 : idx, rename);
  propertiesByName[oldNameNs.name] = propertiesByName[oldNameNs.localName] = newProperty;
};
DescriptorBuilder.prototype.redefineProperty = function(p, targetPropertyName, replace) {
  var nsPrefix = p.ns.prefix;
  var parts = targetPropertyName.split("#");
  var name2 = parseName(parts[0], nsPrefix);
  var attrName = parseName(parts[1], name2.prefix).name;
  var redefinedProperty = this.propertiesByName[attrName];
  if (!redefinedProperty) {
    throw new Error("refined property <" + attrName + "> not found");
  } else {
    this.replaceProperty(redefinedProperty, p, replace);
  }
  delete p.redefines;
};
DescriptorBuilder.prototype.addNamedProperty = function(p, validate) {
  var ns = p.ns, propsByName = this.propertiesByName;
  if (validate) {
    this.assertNotDefined(p, ns.name);
    this.assertNotDefined(p, ns.localName);
  }
  propsByName[ns.name] = propsByName[ns.localName] = p;
};
DescriptorBuilder.prototype.removeNamedProperty = function(p) {
  var ns = p.ns, propsByName = this.propertiesByName;
  delete propsByName[ns.name];
  delete propsByName[ns.localName];
};
DescriptorBuilder.prototype.setBodyProperty = function(p, validate) {
  if (validate && this.bodyProperty) {
    throw new Error(
      "body property defined multiple times (<" + this.bodyProperty.ns.name + ">, <" + p.ns.name + ">)"
    );
  }
  this.bodyProperty = p;
};
DescriptorBuilder.prototype.setIdProperty = function(p, validate) {
  if (validate && this.idProperty) {
    throw new Error(
      "id property defined multiple times (<" + this.idProperty.ns.name + ">, <" + p.ns.name + ">)"
    );
  }
  this.idProperty = p;
};
DescriptorBuilder.prototype.assertNotTrait = function(typeDescriptor) {
  const _extends = typeDescriptor.extends || [];
  if (_extends.length) {
    throw new Error(
      `cannot create <${typeDescriptor.name}> extending <${typeDescriptor.extends}>`
    );
  }
};
DescriptorBuilder.prototype.assertNotDefined = function(p, name2) {
  var propertyName = p.name, definedProperty = this.propertiesByName[propertyName];
  if (definedProperty) {
    throw new Error(
      "property <" + propertyName + "> already defined; override of <" + definedProperty.definedBy.ns.name + "#" + definedProperty.ns.name + "> by <" + p.definedBy.ns.name + "#" + p.ns.name + "> not allowed without redefines"
    );
  }
};
DescriptorBuilder.prototype.hasProperty = function(name2) {
  return this.propertiesByName[name2];
};
DescriptorBuilder.prototype.addTrait = function(t, inherited) {
  if (inherited) {
    this.assertNotTrait(t);
  }
  var typesByName = this.allTypesByName, types2 = this.allTypes;
  var typeName = t.name;
  if (typeName in typesByName) {
    return;
  }
  forEach(t.properties, bind(function(p) {
    p = assign({}, p, {
      name: p.ns.localName,
      inherited
    });
    Object.defineProperty(p, "definedBy", {
      value: t
    });
    var replaces = p.replaces, redefines = p.redefines;
    if (replaces || redefines) {
      this.redefineProperty(p, replaces || redefines, replaces);
    } else {
      if (p.isBody) {
        this.setBodyProperty(p);
      }
      if (p.isId) {
        this.setIdProperty(p);
      }
      this.addProperty(p);
    }
  }, this));
  types2.push(t);
  typesByName[typeName] = t;
};
function Registry(packages2, properties) {
  this.packageMap = /* @__PURE__ */ Object.create(null);
  this.typeMap = /* @__PURE__ */ Object.create(null);
  this.packages = [];
  this.properties = properties;
  forEach(packages2, bind(this.registerPackage, this));
}
Registry.prototype.getPackage = function(uriOrPrefix) {
  return this.packageMap[uriOrPrefix];
};
Registry.prototype.getPackages = function() {
  return this.packages;
};
Registry.prototype.registerPackage = function(pkg) {
  pkg = assign({}, pkg);
  var pkgMap = this.packageMap;
  ensureAvailable(pkgMap, pkg, "prefix");
  ensureAvailable(pkgMap, pkg, "uri");
  forEach(pkg.types, bind(function(descriptor) {
    this.registerType(descriptor, pkg);
  }, this));
  pkgMap[pkg.uri] = pkgMap[pkg.prefix] = pkg;
  this.packages.push(pkg);
};
Registry.prototype.registerType = function(type, pkg) {
  type = assign({}, type, {
    superClass: (type.superClass || []).slice(),
    extends: (type.extends || []).slice(),
    properties: (type.properties || []).slice(),
    meta: assign({}, type.meta || {})
  });
  var ns = parseName(type.name, pkg.prefix), name2 = ns.name, propertiesByName = /* @__PURE__ */ Object.create(null);
  forEach(type.properties, bind(function(p) {
    var propertyNs = parseName(p.name, ns.prefix), propertyName = propertyNs.name;
    if (!isBuiltIn(p.type)) {
      p.type = parseName(p.type, propertyNs.prefix).name;
    }
    assign(p, {
      ns: propertyNs,
      name: propertyName
    });
    propertiesByName[propertyName] = p;
  }, this));
  assign(type, {
    ns,
    name: name2,
    propertiesByName
  });
  forEach(type.extends, bind(function(extendsName) {
    var extendsNameNs = parseName(extendsName, ns.prefix);
    var extended = this.typeMap[extendsNameNs.name];
    extended.traits = extended.traits || [];
    extended.traits.push(name2);
  }, this));
  this.definePackage(type, pkg);
  this.typeMap[name2] = type;
};
Registry.prototype.mapTypes = function(nsName2, iterator, trait) {
  var type = isBuiltIn(nsName2.name) ? { name: nsName2.name } : this.typeMap[nsName2.name];
  var self = this;
  function traverse(cls, trait2) {
    var parentNs = parseName(cls, isBuiltIn(cls) ? "" : nsName2.prefix);
    self.mapTypes(parentNs, iterator, trait2);
  }
  function traverseTrait(cls) {
    return traverse(cls, true);
  }
  function traverseSuper(cls) {
    return traverse(cls, false);
  }
  if (!type) {
    throw new Error("unknown type <" + nsName2.name + ">");
  }
  forEach(type.superClass, trait ? traverseTrait : traverseSuper);
  iterator(type, !trait);
  forEach(type.traits, traverseTrait);
};
Registry.prototype.getEffectiveDescriptor = function(name2) {
  var nsName2 = parseName(name2);
  var builder = new DescriptorBuilder(nsName2);
  this.mapTypes(nsName2, function(type, inherited) {
    builder.addTrait(type, inherited);
  });
  var descriptor = builder.build();
  this.definePackage(descriptor, descriptor.allTypes[descriptor.allTypes.length - 1].$pkg);
  return descriptor;
};
Registry.prototype.definePackage = function(target, pkg) {
  this.properties.define(target, "$pkg", { value: pkg });
};
function ensureAvailable(packageMap, pkg, identifierKey) {
  var value = pkg[identifierKey];
  if (value in packageMap) {
    throw new Error("package with " + identifierKey + " <" + value + "> already defined");
  }
}
function Properties(model) {
  this.model = model;
}
Properties.prototype.set = function(target, name2, value) {
  if (!isString(name2) || !name2.length) {
    throw new TypeError("property name must be a non-empty string");
  }
  var property = this.getProperty(target, name2);
  var propertyName = property && property.name;
  if (isUndefined2(value)) {
    if (property) {
      delete target[propertyName];
    } else {
      delete target.$attrs[stripGlobal(name2)];
    }
  } else {
    if (property) {
      if (propertyName in target) {
        target[propertyName] = value;
      } else {
        defineProperty(target, property, value);
      }
    } else {
      target.$attrs[stripGlobal(name2)] = value;
    }
  }
};
Properties.prototype.get = function(target, name2) {
  var property = this.getProperty(target, name2);
  if (!property) {
    return target.$attrs[stripGlobal(name2)];
  }
  var propertyName = property.name;
  if (!target[propertyName] && property.isMany) {
    defineProperty(target, property, []);
  }
  return target[propertyName];
};
Properties.prototype.define = function(target, name2, options) {
  if (!options.writable) {
    var value = options.value;
    options = assign({}, options, {
      get: function() {
        return value;
      }
    });
    delete options.value;
  }
  Object.defineProperty(target, name2, options);
};
Properties.prototype.defineDescriptor = function(target, descriptor) {
  this.define(target, "$descriptor", { value: descriptor });
};
Properties.prototype.defineModel = function(target, model) {
  this.define(target, "$model", { value: model });
};
Properties.prototype.getProperty = function(target, name2) {
  var model = this.model;
  var property = model.getPropertyDescriptor(target, name2);
  if (property) {
    return property;
  }
  if (name2.includes(":")) {
    return null;
  }
  const strict = model.config.strict;
  if (typeof strict !== "undefined") {
    const error3 = new TypeError(`unknown property <${name2}> on <${target.$type}>`);
    if (strict) {
      throw error3;
    } else {
      typeof console !== "undefined" && console.warn(error3);
    }
  }
  return null;
};
function isUndefined2(val) {
  return typeof val === "undefined";
}
function defineProperty(target, property, value) {
  Object.defineProperty(target, property.name, {
    enumerable: !property.isReference,
    writable: true,
    value,
    configurable: true
  });
}
function stripGlobal(name2) {
  return name2.replace(/^:/, "");
}
function Moddle(packages2, config = {}) {
  this.properties = new Properties(this);
  this.factory = new Factory(this, this.properties);
  this.registry = new Registry(packages2, this.properties);
  this.typeCache = /* @__PURE__ */ Object.create(null);
  this.config = config;
}
Moddle.prototype.create = function(descriptor, attrs) {
  var Type = this.getType(descriptor);
  if (!Type) {
    throw new Error("unknown type <" + descriptor + ">");
  }
  return new Type(attrs);
};
Moddle.prototype.getType = function(descriptor) {
  var cache = this.typeCache;
  var name2 = isString(descriptor) ? descriptor : descriptor.ns.name;
  var type = cache[name2];
  if (!type) {
    descriptor = this.registry.getEffectiveDescriptor(name2);
    type = cache[name2] = this.factory.createType(descriptor);
  }
  return type;
};
Moddle.prototype.createAny = function(name2, nsUri, properties) {
  var nameNs = parseName(name2);
  var element = {
    $type: name2,
    $instanceOf: function(type) {
      return type === this.$type;
    },
    get: function(key) {
      return this[key];
    },
    set: function(key, value) {
      set(this, [key], value);
    }
  };
  var descriptor = {
    name: name2,
    isGeneric: true,
    ns: {
      prefix: nameNs.prefix,
      localName: nameNs.localName,
      uri: nsUri
    }
  };
  this.properties.defineDescriptor(element, descriptor);
  this.properties.defineModel(element, this);
  this.properties.define(element, "get", { enumerable: false, writable: true });
  this.properties.define(element, "set", { enumerable: false, writable: true });
  this.properties.define(element, "$parent", { enumerable: false, writable: true });
  this.properties.define(element, "$instanceOf", { enumerable: false, writable: true });
  forEach(properties, function(a, key) {
    if (isObject(a) && a.value !== void 0) {
      element[a.name] = a.value;
    } else {
      element[key] = a;
    }
  });
  return element;
};
Moddle.prototype.getPackage = function(uriOrPrefix) {
  return this.registry.getPackage(uriOrPrefix);
};
Moddle.prototype.getPackages = function() {
  return this.registry.getPackages();
};
Moddle.prototype.getElementDescriptor = function(element) {
  return element.$descriptor;
};
Moddle.prototype.hasType = function(element, type) {
  if (type === void 0) {
    type = element;
    element = this;
  }
  var descriptor = element.$model.getElementDescriptor(element);
  return type in descriptor.allTypesByName;
};
Moddle.prototype.getPropertyDescriptor = function(element, property) {
  return this.getElementDescriptor(element).propertiesByName[property];
};
Moddle.prototype.getTypeDescriptor = function(type) {
  return this.registry.typeMap[type];
};

// node_modules/saxen/dist/index.js
var fromCharCode = String.fromCharCode;
var hasOwnProperty = Object.prototype.hasOwnProperty;
var ENTITY_PATTERN = /&#(\d+);|&#x([0-9a-f]+);|&(\w+);/ig;
var ENTITY_MAPPING = {
  "amp": "&",
  "apos": "'",
  "gt": ">",
  "lt": "<",
  "quot": '"'
};
Object.keys(ENTITY_MAPPING).forEach(function(k) {
  ENTITY_MAPPING[k.toUpperCase()] = ENTITY_MAPPING[k];
});
function replaceEntities(_, d, x, z) {
  if (z) {
    if (hasOwnProperty.call(ENTITY_MAPPING, z)) {
      return ENTITY_MAPPING[z];
    } else {
      return "&" + z + ";";
    }
  }
  if (d) {
    return fromCharCode(d);
  }
  return fromCharCode(parseInt(x, 16));
}
function decodeEntities(s) {
  if (s.length > 3 && s.indexOf("&") !== -1) {
    return s.replace(ENTITY_PATTERN, replaceEntities);
  }
  return s;
}
var NON_WHITESPACE_OUTSIDE_ROOT_NODE = "non-whitespace outside of root node";
function error(msg) {
  return new Error(msg);
}
function missingNamespaceForPrefix(prefix2) {
  return "missing namespace for prefix <" + prefix2 + ">";
}
function getter(getFn) {
  return {
    "get": getFn,
    "enumerable": true
  };
}
function cloneNsMatrix(nsMatrix) {
  var clone = /* @__PURE__ */ Object.create(null), key;
  for (key in nsMatrix) {
    clone[key] = nsMatrix[key];
  }
  return clone;
}
var NAME_CACHE = Symbol("nameCache");
function uriPrefix(prefix2) {
  return prefix2 + "$uri";
}
function buildNsMatrix(nsUriToPrefix) {
  var nsMatrix = /* @__PURE__ */ Object.create(null), uri2, prefix2;
  for (uri2 in nsUriToPrefix) {
    prefix2 = nsUriToPrefix[uri2];
    nsMatrix[prefix2] = prefix2;
    nsMatrix[uriPrefix(prefix2)] = uri2;
  }
  return nsMatrix;
}
function noopGetContext() {
  return { line: 0, column: 0 };
}
function throwFunc(err) {
  throw err;
}
function Parser(options) {
  if (!this) {
    return new Parser(options);
  }
  var proxy = options && options["proxy"];
  var onText, onOpenTag, onCloseTag, onCDATA, onError = throwFunc, onWarning, onComment, onQuestion, onAttention;
  var getContext = noopGetContext;
  var streaming = false;
  var rootTagFound = false;
  var leftoverXml = "";
  var maybeNS = false;
  var isNamespace = false;
  var returnError = null;
  var parseStop = false;
  var nsMatrixStack, nsMatrix, nodeStack;
  var nsUriToPrefix;
  function handleError(err) {
    if (!(err instanceof Error)) {
      err = error(err);
    }
    returnError = err;
    onError(err, getContext);
  }
  function handleWarning(err) {
    if (!onWarning) {
      return;
    }
    if (!(err instanceof Error)) {
      err = error(err);
    }
    onWarning(err, getContext);
  }
  this["on"] = function(name2, cb) {
    if (typeof cb !== "function") {
      throw error("required args <name, cb>");
    }
    switch (name2) {
      case "openTag":
        onOpenTag = cb;
        break;
      case "text":
        onText = cb;
        break;
      case "closeTag":
        onCloseTag = cb;
        break;
      case "error":
        onError = cb;
        break;
      case "warn":
        onWarning = cb;
        break;
      case "cdata":
        onCDATA = cb;
        break;
      case "attention":
        onAttention = cb;
        break;
      // <!XXXXX zzzz="eeee">
      case "question":
        onQuestion = cb;
        break;
      // <? ....  ?>
      case "comment":
        onComment = cb;
        break;
      default:
        throw error("unsupported event: " + name2);
    }
    return this;
  };
  this["ns"] = function(nsMap) {
    if (typeof nsMap === "undefined") {
      nsMap = {};
    }
    if (typeof nsMap !== "object") {
      throw error("required args <nsMap={}>");
    }
    var _nsUriToPrefix = /* @__PURE__ */ Object.create(null), k;
    for (k in nsMap) {
      _nsUriToPrefix[k] = nsMap[k];
    }
    isNamespace = true;
    nsUriToPrefix = _nsUriToPrefix;
    return this;
  };
  function resetState() {
    nsMatrixStack = isNamespace ? [] : null;
    nsMatrix = isNamespace ? buildNsMatrix(nsUriToPrefix) : null;
    nodeStack = [];
    getContext = noopGetContext;
    parseStop = false;
    returnError = null;
    rootTagFound = false;
    leftoverXml = "";
  }
  this["parse"] = function(xml2) {
    if (typeof xml2 !== "string") {
      throw error("required args <xml=string>");
    }
    if (streaming) {
      throw error("parse during stream; call end() first");
    }
    resetState();
    parse(xml2);
    getContext = noopGetContext;
    parseStop = false;
    return returnError;
  };
  this["write"] = function(xml2) {
    if (typeof xml2 !== "string") {
      throw error("required args <xml=string>");
    }
    if (!streaming) {
      resetState();
      streaming = true;
    }
    if (!returnError) {
      leftoverXml = parse(leftoverXml + xml2, true) || "";
    }
    return this;
  };
  this["end"] = function() {
    if (!streaming) {
      resetState();
    }
    streaming = false;
    if (!returnError) {
      parse(leftoverXml);
    }
    leftoverXml = "";
    getContext = noopGetContext;
    parseStop = false;
    return returnError;
  };
  this["stop"] = function() {
    parseStop = true;
  };
  function parse(xml2, streaming2 = false) {
    var elNameCache = null, elNameCacheMatrix = null;
    var _nsMatrix, anonymousNsCount = 0, tagStart = false, tagEnd = false, i = 0, j = 0, x, y, q, w, v, xmlns, elementName, _elementName, elementProxy;
    var attrsString = "", attrsStart = 0, cachedAttrs;
    function normalizeAttrName(name2, defaultAlias) {
      var w2 = name2.indexOf(":");
      if (w2 === -1) {
        return name2;
      }
      var nsName2 = nsMatrix[name2.substring(0, w2)];
      if (!nsName2) {
        handleWarning(missingNamespaceForPrefix(name2.substring(0, w2)));
        return null;
      }
      return defaultAlias === nsName2 ? name2.substr(w2 + 1) : nsName2 + name2.substr(w2);
    }
    function getAttrs() {
      if (cachedAttrs !== null) {
        return cachedAttrs;
      }
      var nsUri, nsUriPrefix, defaultAlias = isNamespace && nsMatrix["xmlns"], attrList = isNamespace && maybeNS ? [] : null, i2 = attrsStart, s = attrsString, l = s.length, hasNewMatrix, newalias, value, alias, name2, attrs = {}, seenAttrs = /* @__PURE__ */ new Set(), skipAttr, w2, j2;
      parseAttr:
        for (; i2 < l; i2++) {
          skipAttr = false;
          w2 = s.charCodeAt(i2);
          if (w2 === 32 || w2 < 14 && w2 > 8) {
            continue;
          }
          if (w2 < 65 || w2 > 122 || w2 > 90 && w2 < 97) {
            if (w2 !== 95 && w2 !== 58) {
              handleWarning("illegal first char attribute name");
              skipAttr = true;
            }
          }
          for (j2 = i2 + 1; j2 < l; j2++) {
            w2 = s.charCodeAt(j2);
            if (w2 > 96 && w2 < 123 || w2 > 64 && w2 < 91 || w2 > 47 && w2 < 59 || w2 === 46 || // '.'
            w2 === 45 || // '-'
            w2 === 95) {
              continue;
            }
            if (w2 === 32 || w2 < 14 && w2 > 8) {
              handleWarning("missing attribute value");
              i2 = j2;
              continue parseAttr;
            }
            if (w2 === 61) {
              break;
            }
            handleWarning("illegal attribute name char");
            skipAttr = true;
          }
          name2 = s.substring(i2, j2);
          if (name2 === "xmlns:xmlns") {
            handleWarning("illegal declaration of xmlns");
            skipAttr = true;
          }
          w2 = s.charCodeAt(j2 + 1);
          if (w2 === 34) {
            j2 = s.indexOf('"', i2 = j2 + 2);
            if (j2 === -1) {
              j2 = s.indexOf("'", i2);
              if (j2 !== -1) {
                handleWarning("attribute value quote missmatch");
                skipAttr = true;
              }
            }
          } else if (w2 === 39) {
            j2 = s.indexOf("'", i2 = j2 + 2);
            if (j2 === -1) {
              j2 = s.indexOf('"', i2);
              if (j2 !== -1) {
                handleWarning("attribute value quote missmatch");
                skipAttr = true;
              }
            }
          } else {
            handleWarning("missing attribute value quotes");
            skipAttr = true;
            for (j2 = j2 + 1; j2 < l; j2++) {
              w2 = s.charCodeAt(j2 + 1);
              if (w2 === 32 || w2 < 14 && w2 > 8) {
                break;
              }
            }
          }
          if (j2 === -1) {
            handleWarning("missing closing quotes");
            j2 = l;
            skipAttr = true;
          }
          if (!skipAttr) {
            value = s.substring(i2, j2);
          }
          i2 = j2;
          for (; j2 + 1 < l; j2++) {
            w2 = s.charCodeAt(j2 + 1);
            if (w2 === 32 || w2 < 14 && w2 > 8) {
              break;
            }
            if (i2 === j2) {
              handleWarning("illegal character after attribute end");
              skipAttr = true;
            }
          }
          i2 = j2 + 1;
          if (skipAttr) {
            continue parseAttr;
          }
          if (seenAttrs.has(name2)) {
            handleWarning("attribute <" + name2 + "> already defined");
            continue;
          }
          seenAttrs.add(name2);
          if (!isNamespace) {
            attrs[name2] = value;
            continue;
          }
          if (maybeNS) {
            newalias = name2 === "xmlns" ? "xmlns" : name2.charCodeAt(0) === 120 && name2.substr(0, 6) === "xmlns:" ? name2.substr(6) : null;
            if (newalias !== null) {
              nsUri = decodeEntities(value);
              nsUriPrefix = uriPrefix(newalias);
              alias = nsUriToPrefix[nsUri];
              if (!alias) {
                if (newalias === "xmlns" || nsUriPrefix in nsMatrix && nsMatrix[nsUriPrefix] !== nsUri) {
                  do {
                    alias = "ns" + anonymousNsCount++;
                  } while (typeof nsMatrix[alias] !== "undefined");
                } else {
                  alias = newalias;
                }
                nsUriToPrefix[nsUri] = alias;
              }
              if (nsMatrix[newalias] !== alias) {
                if (!hasNewMatrix) {
                  nsMatrix = cloneNsMatrix(nsMatrix);
                  hasNewMatrix = true;
                }
                nsMatrix[newalias] = alias;
                if (newalias === "xmlns") {
                  nsMatrix[uriPrefix(alias)] = nsUri;
                  defaultAlias = alias;
                }
                nsMatrix[nsUriPrefix] = nsUri;
              }
              attrs[name2] = value;
              continue;
            }
            attrList.push(name2, value);
            continue;
          }
          name2 = normalizeAttrName(name2, defaultAlias);
          if (name2 === null) {
            continue;
          }
          attrs[name2] = value;
        }
      if (maybeNS) {
        for (i2 = 0, l = attrList.length; i2 < l; i2++) {
          name2 = normalizeAttrName(attrList[i2++], defaultAlias);
          value = attrList[i2];
          if (name2 === null) {
            continue;
          }
          attrs[name2] = value;
        }
      }
      return cachedAttrs = attrs;
    }
    function getParseContext() {
      var splitsRe = /(\r\n|\r|\n)/g;
      var line = 0;
      var column = 0;
      var startOfLine = 0;
      var endOfLine = j;
      var match;
      var data;
      while (i >= startOfLine) {
        match = splitsRe.exec(xml2);
        if (!match) {
          break;
        }
        endOfLine = match[0].length + match.index;
        if (endOfLine > i) {
          break;
        }
        line += 1;
        startOfLine = endOfLine;
      }
      if (i == -1) {
        column = endOfLine;
        data = xml2.substring(j);
      } else if (j === 0) {
        data = xml2.substring(j, i);
      } else {
        column = i - startOfLine;
        data = j == -1 ? xml2.substring(i) : xml2.substring(i, j + 1);
      }
      return {
        "data": data,
        "line": line,
        "column": column
      };
    }
    getContext = getParseContext;
    if (proxy) {
      elementProxy = Object.create({}, {
        "name": getter(function() {
          return elementName;
        }),
        "originalName": getter(function() {
          return _elementName;
        }),
        "attrs": getter(getAttrs),
        "ns": getter(function() {
          return nsMatrix;
        })
      });
    }
    while (j !== -1) {
      if (xml2.charCodeAt(j) === 60) {
        i = j;
      } else {
        i = xml2.indexOf("<", j);
      }
      if (i === -1) {
        if (streaming2) {
          return xml2.substring(j);
        }
        if (nodeStack.length) {
          return handleError("unexpected end of file");
        }
        if (!rootTagFound) {
          return handleError("missing start tag");
        }
        if (j < xml2.length) {
          if (xml2.substring(j).trim()) {
            handleWarning(NON_WHITESPACE_OUTSIDE_ROOT_NODE);
          }
        }
        return;
      }
      if (!rootTagFound) {
        rootTagFound = true;
      }
      if (j !== i) {
        if (nodeStack.length) {
          if (onText) {
            onText(xml2.substring(j, i), decodeEntities, getContext);
            if (parseStop) {
              return;
            }
          }
        } else {
          if (xml2.substring(j, i).trim()) {
            handleWarning(NON_WHITESPACE_OUTSIDE_ROOT_NODE);
            if (parseStop) {
              return;
            }
          }
        }
      }
      w = xml2.charCodeAt(i + 1);
      if (w === 33) {
        q = xml2.charCodeAt(i + 2);
        if (q === 91 && xml2.substr(i + 3, 6) === "CDATA[") {
          j = xml2.indexOf("]]>", i);
          if (j === -1) {
            if (streaming2) {
              return xml2.substring(i);
            }
            return handleError("unclosed cdata");
          }
          if (onCDATA) {
            onCDATA(xml2.substring(i + 9, j), getContext);
            if (parseStop) {
              return;
            }
          }
          j += 3;
          continue;
        }
        if (q === 45 && xml2.charCodeAt(i + 3) === 45) {
          j = xml2.indexOf("-->", i);
          if (j === -1) {
            if (streaming2) {
              return xml2.substring(i);
            }
            return handleError("unclosed comment");
          }
          if (onComment) {
            onComment(xml2.substring(i + 4, j), decodeEntities, getContext);
            if (parseStop) {
              return;
            }
          }
          j += 3;
          continue;
        }
      }
      if (w === 63) {
        j = xml2.indexOf("?>", i);
        if (j === -1) {
          if (streaming2) {
            return xml2.substring(i);
          }
          return handleError("unclosed question");
        }
        if (onQuestion) {
          onQuestion(xml2.substring(i, j + 2), getContext);
          if (parseStop) {
            return;
          }
        }
        j += 2;
        continue;
      }
      for (x = i + 1; ; x++) {
        v = xml2.charCodeAt(x);
        if (isNaN(v)) {
          if (streaming2) {
            return xml2.substring(i);
          }
          j = -1;
          return handleError("unclosed tag");
        }
        if (v === 34) {
          q = xml2.indexOf('"', x + 1);
          x = q !== -1 ? q : x;
        } else if (v === 39) {
          q = xml2.indexOf("'", x + 1);
          x = q !== -1 ? q : x;
        } else if (v === 62) {
          j = x;
          break;
        }
      }
      if (w === 33) {
        if (onAttention) {
          onAttention(xml2.substring(i, j + 1), decodeEntities, getContext);
          if (parseStop) {
            return;
          }
        }
        j += 1;
        continue;
      }
      cachedAttrs = {};
      if (w === 47) {
        tagStart = false;
        tagEnd = true;
        if (!nodeStack.length) {
          return handleError("missing open tag");
        }
        x = elementName = nodeStack.pop();
        q = i + 2 + x.length;
        if (xml2.substring(i + 2, q) !== x) {
          return handleError("closing tag mismatch");
        }
        for (; q < j; q++) {
          w = xml2.charCodeAt(q);
          if (w === 32 || w > 8 && w < 14) {
            continue;
          }
          return handleError("close tag");
        }
      } else {
        if (xml2.charCodeAt(j - 1) === 47) {
          x = elementName = xml2.substring(i + 1, j - 1);
          tagStart = true;
          tagEnd = true;
        } else {
          x = elementName = xml2.substring(i + 1, j);
          tagStart = true;
          tagEnd = false;
        }
        if (!(w > 96 && w < 123 || w > 64 && w < 91 || w === 95 || w === 58)) {
          return handleError("illegal first char nodeName");
        }
        for (q = 1, y = x.length; q < y; q++) {
          w = x.charCodeAt(q);
          if (w > 96 && w < 123 || w > 64 && w < 91 || w > 47 && w < 59 || w === 45 || w === 95 || w == 46) {
            continue;
          }
          if (w === 32 || w < 14 && w > 8) {
            elementName = x.substring(0, q);
            cachedAttrs = null;
            break;
          }
          return handleError("invalid nodeName");
        }
        if (!tagEnd) {
          nodeStack.push(elementName);
        }
      }
      if (isNamespace) {
        _nsMatrix = nsMatrix;
        if (tagStart) {
          if (!tagEnd) {
            nsMatrixStack.push(_nsMatrix);
          }
          if (cachedAttrs === null) {
            if (maybeNS = x.indexOf("xmlns", q) !== -1) {
              attrsStart = q;
              attrsString = x;
              getAttrs();
              maybeNS = false;
            }
          }
        }
        _elementName = elementName;
        if (elNameCacheMatrix !== nsMatrix) {
          elNameCache = nsMatrix[NAME_CACHE];
          if (elNameCache === void 0) {
            elNameCache = nsMatrix[NAME_CACHE] = /* @__PURE__ */ Object.create(null);
          }
          elNameCacheMatrix = nsMatrix;
        }
        var _cachedName = elNameCache[elementName];
        if (_cachedName !== void 0) {
          elementName = _cachedName;
        } else {
          w = elementName.indexOf(":");
          if (w !== -1) {
            xmlns = nsMatrix[elementName.substring(0, w)];
            if (!xmlns) {
              return handleError("missing namespace on <" + _elementName + ">");
            }
            elementName = elementName.substr(w + 1);
          } else {
            xmlns = nsMatrix["xmlns"];
          }
          if (xmlns) {
            elementName = xmlns + ":" + elementName;
          }
          elNameCache[_elementName] = elementName;
        }
      }
      if (tagStart) {
        attrsStart = q;
        attrsString = x;
        if (onOpenTag) {
          if (proxy) {
            onOpenTag(elementProxy, decodeEntities, tagEnd, getContext);
          } else {
            onOpenTag(elementName, getAttrs, decodeEntities, tagEnd, getContext);
          }
          if (parseStop) {
            return;
          }
        }
      }
      if (tagEnd) {
        if (onCloseTag) {
          onCloseTag(proxy ? elementProxy : elementName, decodeEntities, tagStart, getContext);
          if (parseStop) {
            return;
          }
        }
        if (isNamespace) {
          if (!tagStart) {
            nsMatrix = nsMatrixStack.pop();
          } else {
            nsMatrix = _nsMatrix;
          }
        }
      }
      j += 1;
    }
  }
}

// node_modules/moddle-xml/dist/index.js
function hasLowerCaseAlias(pkg) {
  return pkg.xml && pkg.xml.tagAlias === "lowerCase";
}
var DEFAULT_NS_MAP = {
  "xsi": "http://www.w3.org/2001/XMLSchema-instance",
  "xml": "http://www.w3.org/XML/1998/namespace"
};
var SERIALIZE_PROPERTY = "property";
function getSerialization(element) {
  return element.xml && element.xml.serialize;
}
function getSerializationType(element) {
  const type = getSerialization(element);
  return type !== SERIALIZE_PROPERTY && (type || null);
}
function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
function aliasToName(aliasNs, pkg) {
  if (!hasLowerCaseAlias(pkg)) {
    return aliasNs.name;
  }
  return aliasNs.prefix + ":" + capitalize(aliasNs.localName);
}
function prefixedToName(nameNs, pkg) {
  var name2 = nameNs.name, localName = nameNs.localName;
  var typePrefix = pkg && pkg.xml && pkg.xml.typePrefix;
  if (typePrefix && localName.indexOf(typePrefix) === 0) {
    return nameNs.prefix + ":" + localName.slice(typePrefix.length);
  } else {
    return name2;
  }
}
function normalizeTypeName(name2, nsMap, model) {
  const nameNs = parseName(name2, nsMap.xmlns);
  const normalizedName = `${nsMap[nameNs.prefix] || nameNs.prefix}:${nameNs.localName}`;
  const normalizedNameNs = parseName(normalizedName);
  var pkg = model.getPackage(normalizedNameNs.prefix);
  return prefixedToName(normalizedNameNs, pkg);
}
function error2(message) {
  return new Error(message);
}
function getModdleDescriptor(element) {
  return element.$descriptor;
}
function Context(options) {
  assign(this, options);
  this.elementsById = {};
  this.references = [];
  this.warnings = [];
  this.addReference = function(reference) {
    this.references.push(reference);
  };
  this.addElement = function(element) {
    if (!element) {
      throw error2("expected element");
    }
    var elementsById = this.elementsById;
    var descriptor = getModdleDescriptor(element);
    var idProperty = descriptor.idProperty, id;
    if (idProperty) {
      id = element.get(idProperty.name);
      if (id) {
        if (!/^([a-z][\w-.]*:)?[a-z_][\w-.]*$/i.test(id)) {
          throw new Error("illegal ID <" + id + ">");
        }
        if (elementsById[id]) {
          throw error2("duplicate ID <" + id + ">");
        }
        elementsById[id] = element;
      }
    }
  };
  this.addWarning = function(warning) {
    this.warnings.push(warning);
  };
}
function BaseHandler() {
}
BaseHandler.prototype.handleEnd = function() {
};
BaseHandler.prototype.handleText = function() {
};
BaseHandler.prototype.handleNode = function() {
};
function NoopHandler() {
}
NoopHandler.prototype = Object.create(BaseHandler.prototype);
NoopHandler.prototype.handleNode = function() {
  return this;
};
function BodyHandler() {
}
BodyHandler.prototype = Object.create(BaseHandler.prototype);
BodyHandler.prototype.handleText = function(text) {
  this.body = (this.body || "") + text;
};
function ReferenceHandler(property, context) {
  this.property = property;
  this.context = context;
}
ReferenceHandler.prototype = Object.create(BodyHandler.prototype);
ReferenceHandler.prototype.handleNode = function(node) {
  if (this.element) {
    throw error2("expected no sub nodes");
  } else {
    this.element = this.createReference(node);
  }
  return this;
};
ReferenceHandler.prototype.handleEnd = function() {
  this.element.id = this.body;
};
ReferenceHandler.prototype.createReference = function(node) {
  return {
    property: this.property.ns.name,
    id: ""
  };
};
function ValueHandler(propertyDesc, element) {
  this.element = element;
  this.propertyDesc = propertyDesc;
}
ValueHandler.prototype = Object.create(BodyHandler.prototype);
ValueHandler.prototype.handleEnd = function() {
  var value = this.body || "", element = this.element, propertyDesc = this.propertyDesc;
  value = coerceType(propertyDesc.type, value);
  if (propertyDesc.isMany) {
    element.get(propertyDesc.name).push(value);
  } else {
    element.set(propertyDesc.name, value);
  }
};
function BaseElementHandler() {
}
BaseElementHandler.prototype = Object.create(BodyHandler.prototype);
BaseElementHandler.prototype.handleNode = function(node) {
  var parser = this, element = this.element;
  if (!element) {
    element = this.element = this.createElement(node);
    this.context.addElement(element);
  } else {
    parser = this.handleChild(node);
  }
  return parser;
};
function ElementHandler(model, typeName, context) {
  this.model = model;
  this.type = model.getType(typeName);
  this.context = context;
}
ElementHandler.prototype = Object.create(BaseElementHandler.prototype);
ElementHandler.prototype.addReference = function(reference) {
  this.context.addReference(reference);
};
ElementHandler.prototype.handleText = function(text) {
  var element = this.element, descriptor = getModdleDescriptor(element), bodyProperty = descriptor.bodyProperty;
  if (!bodyProperty) {
    throw error2("unexpected body text <" + text + ">");
  }
  BodyHandler.prototype.handleText.call(this, text);
};
ElementHandler.prototype.handleEnd = function() {
  var value = this.body, element = this.element, descriptor = getModdleDescriptor(element), bodyProperty = descriptor.bodyProperty;
  if (bodyProperty && value !== void 0) {
    value = coerceType(bodyProperty.type, value);
    element.set(bodyProperty.name, value);
  }
};
ElementHandler.prototype.createElement = function(node) {
  var attributes = node.attributes, Type = this.type, descriptor = getModdleDescriptor(Type), context = this.context, instance = new Type({}), model = this.model, propNameNs;
  forEach(attributes, function(value, name2) {
    var prop = descriptor.propertiesByName[name2], values;
    if (prop && prop.isReference) {
      if (!prop.isMany) {
        context.addReference({
          element: instance,
          property: prop.ns.name,
          id: value
        });
      } else {
        values = value.split(" ");
        forEach(values, function(v) {
          context.addReference({
            element: instance,
            property: prop.ns.name,
            id: v
          });
        });
      }
    } else {
      if (prop) {
        value = coerceType(prop.type, value);
      } else if (name2 === "xmlns") {
        name2 = ":" + name2;
      } else {
        propNameNs = parseName(name2, descriptor.ns.prefix);
        if (model.getPackage(propNameNs.prefix)) {
          context.addWarning({
            message: "unknown attribute <" + name2 + ">",
            element: instance,
            property: name2,
            value
          });
        }
      }
      instance.set(name2, value);
    }
  });
  return instance;
};
ElementHandler.prototype.getPropertyForNode = function(node) {
  var name2 = node.name;
  var nameNs = parseName(name2);
  var type = this.type, model = this.model, descriptor = getModdleDescriptor(type);
  var propertyName = nameNs.name, property = descriptor.propertiesByName[propertyName];
  if (property && !property.isAttr) {
    const serializationType = getSerializationType(property);
    if (serializationType) {
      const elementTypeName = node.attributes[serializationType];
      if (elementTypeName) {
        const normalizedTypeName = normalizeTypeName(elementTypeName, node.ns, model);
        const elementType = model.getType(normalizedTypeName);
        return assign({}, property, {
          effectiveType: getModdleDescriptor(elementType).name
        });
      }
    }
    return property;
  }
  var pkg = model.getPackage(nameNs.prefix);
  if (pkg) {
    const elementTypeName = aliasToName(nameNs, pkg);
    const elementType = model.getType(elementTypeName);
    property = find(descriptor.properties, function(p) {
      return !p.isVirtual && !p.isReference && !p.isAttribute && elementType.hasType(p.type);
    });
    if (property) {
      return assign({}, property, {
        effectiveType: getModdleDescriptor(elementType).name
      });
    }
  } else {
    property = find(descriptor.properties, function(p) {
      return !p.isReference && !p.isAttribute && p.type === "Element";
    });
    if (property) {
      return property;
    }
  }
  throw error2("unrecognized element <" + nameNs.name + ">");
};
ElementHandler.prototype.toString = function() {
  return "ElementDescriptor[" + getModdleDescriptor(this.type).name + "]";
};
ElementHandler.prototype.valueHandler = function(propertyDesc, element) {
  return new ValueHandler(propertyDesc, element);
};
ElementHandler.prototype.referenceHandler = function(propertyDesc) {
  return new ReferenceHandler(propertyDesc, this.context);
};
ElementHandler.prototype.handler = function(type) {
  if (type === "Element") {
    return new GenericElementHandler(this.model, type, this.context);
  } else {
    return new ElementHandler(this.model, type, this.context);
  }
};
ElementHandler.prototype.handleChild = function(node) {
  var propertyDesc, type, element, childHandler;
  propertyDesc = this.getPropertyForNode(node);
  element = this.element;
  type = propertyDesc.effectiveType || propertyDesc.type;
  if (isSimple(type)) {
    return this.valueHandler(propertyDesc, element);
  }
  if (propertyDesc.isReference) {
    childHandler = this.referenceHandler(propertyDesc).handleNode(node);
  } else {
    childHandler = this.handler(type).handleNode(node);
  }
  var newElement = childHandler.element;
  if (newElement !== void 0) {
    if (propertyDesc.isMany) {
      element.get(propertyDesc.name).push(newElement);
    } else {
      element.set(propertyDesc.name, newElement);
    }
    if (propertyDesc.isReference) {
      assign(newElement, {
        element
      });
      this.context.addReference(newElement);
    } else {
      newElement.$parent = element;
    }
  }
  return childHandler;
};
function RootElementHandler(model, typeName, context) {
  ElementHandler.call(this, model, typeName, context);
}
RootElementHandler.prototype = Object.create(ElementHandler.prototype);
RootElementHandler.prototype.createElement = function(node) {
  var name2 = node.name, nameNs = parseName(name2), model = this.model, type = this.type, pkg = model.getPackage(nameNs.prefix), typeName = pkg && aliasToName(nameNs, pkg) || name2;
  if (!type.hasType(typeName)) {
    throw error2("unexpected element <" + node.originalName + ">");
  }
  return ElementHandler.prototype.createElement.call(this, node);
};
function GenericElementHandler(model, typeName, context) {
  this.model = model;
  this.context = context;
}
GenericElementHandler.prototype = Object.create(BaseElementHandler.prototype);
GenericElementHandler.prototype.createElement = function(node) {
  var name2 = node.name, ns = parseName(name2), prefix2 = ns.prefix, uri2 = node.ns[prefix2 + "$uri"], attributes = node.attributes;
  return this.model.createAny(name2, uri2, attributes);
};
GenericElementHandler.prototype.handleChild = function(node) {
  var handler = new GenericElementHandler(this.model, "Element", this.context).handleNode(node), element = this.element;
  var newElement = handler.element, children;
  if (newElement !== void 0) {
    children = element.$children = element.$children || [];
    children.push(newElement);
    newElement.$parent = element;
  }
  return handler;
};
GenericElementHandler.prototype.handleEnd = function() {
  if (this.body) {
    this.element.$body = this.body;
  }
};
function Reader(options) {
  if (options instanceof Moddle) {
    options = {
      model: options
    };
  }
  assign(this, { lax: false }, options);
}
Reader.prototype.fromXML = function(xml2, options, done) {
  var rootHandler = options.rootHandler;
  if (options instanceof ElementHandler) {
    rootHandler = options;
    options = {};
  } else {
    if (typeof options === "string") {
      rootHandler = this.handler(options);
      options = {};
    } else if (typeof rootHandler === "string") {
      rootHandler = this.handler(rootHandler);
    }
  }
  var model = this.model, lax = this.lax;
  var context = new Context(assign({}, options, { rootHandler })), parser = new Parser({ proxy: true }), stack = createStack();
  rootHandler.context = context;
  stack.push(rootHandler);
  function handleError(err, getContext, lax2) {
    var ctx = getContext();
    var line = ctx.line, column = ctx.column, data = ctx.data;
    if (data.charAt(0) === "<" && data.indexOf(" ") !== -1) {
      data = data.slice(0, data.indexOf(" ")) + ">";
    }
    var message = "unparsable content " + (data ? data + " " : "") + "detected\n	line: " + line + "\n	column: " + column + "\n	nested error: " + err.message;
    if (lax2) {
      context.addWarning({
        message,
        error: err
      });
      return true;
    } else {
      throw error2(message);
    }
  }
  function handleWarning(err, getContext) {
    return handleError(err, getContext, true);
  }
  function resolveReferences() {
    var elementsById = context.elementsById;
    var references = context.references;
    var i, r;
    for (i = 0; r = references[i]; i++) {
      var element = r.element;
      var reference = elementsById[r.id];
      var property = getModdleDescriptor(element).propertiesByName[r.property];
      if (!reference) {
        context.addWarning({
          message: "unresolved reference <" + r.id + ">",
          element: r.element,
          property: r.property,
          value: r.id
        });
      }
      if (property.isMany) {
        var collection = element.get(property.name), idx = collection.indexOf(r);
        if (idx === -1) {
          idx = collection.length;
        }
        if (!reference) {
          collection.splice(idx, 1);
        } else {
          collection[idx] = reference;
        }
      } else {
        element.set(property.name, reference);
      }
    }
  }
  function handleClose() {
    stack.pop().handleEnd();
  }
  var PREAMBLE_START_PATTERN = /^<\?xml /i;
  var ENCODING_PATTERN = / encoding="([^"]+)"/i;
  var UTF_8_PATTERN = /^utf-8$/i;
  function handleQuestion(question) {
    if (!PREAMBLE_START_PATTERN.test(question)) {
      return;
    }
    var match = ENCODING_PATTERN.exec(question);
    var encoding = match && match[1];
    if (!encoding || UTF_8_PATTERN.test(encoding)) {
      return;
    }
    context.addWarning({
      message: "unsupported document encoding <" + encoding + ">, falling back to UTF-8"
    });
  }
  function handleOpen(node, getContext) {
    var handler = stack.peek();
    try {
      stack.push(handler.handleNode(node));
    } catch (err) {
      if (handleError(err, getContext, lax)) {
        stack.push(new NoopHandler());
      }
    }
  }
  function handleCData(text, getContext) {
    try {
      stack.peek().handleText(text);
    } catch (err) {
      handleWarning(err, getContext);
    }
  }
  function handleText(text, getContext) {
    if (!text.trim()) {
      return;
    }
    handleCData(text, getContext);
  }
  var uriMap = model.getPackages().reduce(function(uriMap2, p) {
    uriMap2[p.uri] = p.prefix;
    return uriMap2;
  }, Object.entries(DEFAULT_NS_MAP).reduce(function(map2, [prefix2, url]) {
    map2[url] = prefix2;
    return map2;
  }, model.config && model.config.nsMap || {}));
  parser.ns(uriMap).on("openTag", function(obj, decodeStr, selfClosing, getContext) {
    var attrs = obj.attrs || {};
    var decodedAttrs = Object.keys(attrs).reduce(function(d, key) {
      var value = decodeStr(attrs[key]);
      d[key] = value;
      return d;
    }, {});
    var node = {
      name: obj.name,
      originalName: obj.originalName,
      attributes: decodedAttrs,
      ns: obj.ns
    };
    handleOpen(node, getContext);
  }).on("question", handleQuestion).on("closeTag", handleClose).on("cdata", handleCData).on("text", function(text, decodeEntities2, getContext) {
    handleText(decodeEntities2(text), getContext);
  }).on("error", handleError).on("warn", handleWarning);
  return new Promise(function(resolve, reject) {
    var err;
    try {
      parser.parse(xml2);
      resolveReferences();
    } catch (e) {
      err = e;
    }
    var rootElement = rootHandler.element;
    if (!err && !rootElement) {
      err = error2("failed to parse document as <" + rootHandler.type.$descriptor.name + ">");
    }
    var warnings = context.warnings;
    var references = context.references;
    var elementsById = context.elementsById;
    if (err) {
      err.warnings = warnings;
      return reject(err);
    } else {
      return resolve({
        rootElement,
        elementsById,
        references,
        warnings
      });
    }
  });
};
Reader.prototype.handler = function(name2) {
  return new RootElementHandler(this.model, name2);
};
function createStack() {
  var stack = [];
  Object.defineProperty(stack, "peek", {
    value: function() {
      return this[this.length - 1];
    }
  });
  return stack;
}
var XML_PREAMBLE = '<?xml version="1.0" encoding="UTF-8"?>\n';
var ESCAPE_ATTR_CHARS = /<|>|'|"|&|\n\r|\n/g;
var ESCAPE_CHARS = /<|>|&/g;
function Namespaces(parent) {
  this.prefixMap = {};
  this.uriMap = {};
  this.used = {};
  this.wellknown = [];
  this.custom = [];
  this.parent = parent;
  this.defaultPrefixMap = parent && parent.defaultPrefixMap || {};
}
Namespaces.prototype.mapDefaultPrefixes = function(defaultPrefixMap) {
  this.defaultPrefixMap = defaultPrefixMap;
};
Namespaces.prototype.defaultUriByPrefix = function(prefix2) {
  return this.defaultPrefixMap[prefix2];
};
Namespaces.prototype.byUri = function(uri2) {
  return this.uriMap[uri2] || this.parent && this.parent.byUri(uri2);
};
Namespaces.prototype.add = function(ns, isWellknown) {
  this.uriMap[ns.uri] = ns;
  if (isWellknown) {
    this.wellknown.push(ns);
  } else {
    this.custom.push(ns);
  }
  this.mapPrefix(ns.prefix, ns.uri);
};
Namespaces.prototype.uriByPrefix = function(prefix2) {
  return this.prefixMap[prefix2 || "xmlns"] || this.parent && this.parent.uriByPrefix(prefix2);
};
Namespaces.prototype.mapPrefix = function(prefix2, uri2) {
  this.prefixMap[prefix2 || "xmlns"] = uri2;
};
Namespaces.prototype.getNSKey = function(ns) {
  return ns.prefix !== void 0 ? ns.uri + "|" + ns.prefix : ns.uri;
};
Namespaces.prototype.logUsed = function(ns) {
  var uri2 = ns.uri;
  var nsKey = this.getNSKey(ns);
  this.used[nsKey] = this.byUri(uri2);
  if (this.parent) {
    this.parent.logUsed(ns);
  }
};
Namespaces.prototype.getUsed = function(ns) {
  var allNs = [].concat(this.wellknown, this.custom);
  return allNs.filter((ns2) => {
    var nsKey = this.getNSKey(ns2);
    return this.used[nsKey];
  });
};
function lower(string) {
  return string.charAt(0).toLowerCase() + string.slice(1);
}
function nameToAlias(name2, pkg) {
  if (hasLowerCaseAlias(pkg)) {
    return lower(name2);
  } else {
    return name2;
  }
}
function inherits(ctor, superCtor) {
  ctor.super_ = superCtor;
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: {
      value: ctor,
      enumerable: false,
      writable: true,
      configurable: true
    }
  });
}
function nsName(ns) {
  if (isString(ns)) {
    return ns;
  } else {
    return (ns.prefix ? ns.prefix + ":" : "") + ns.localName;
  }
}
function getNsAttrs(namespaces) {
  return namespaces.getUsed().filter(function(ns) {
    return ns.prefix !== "xml";
  }).map(function(ns) {
    var name2 = "xmlns" + (ns.prefix ? ":" + ns.prefix : "");
    return { name: name2, value: ns.uri };
  });
}
function getElementNs(ns, descriptor) {
  if (descriptor.isGeneric) {
    return assign({ localName: descriptor.ns.localName }, ns);
  } else {
    return assign({ localName: nameToAlias(descriptor.ns.localName, descriptor.$pkg) }, ns);
  }
}
function getPropertyNs(ns, descriptor) {
  return assign({ localName: descriptor.ns.localName }, ns);
}
function getSerializableProperties(element) {
  var descriptor = element.$descriptor;
  return filter(descriptor.properties, function(p) {
    var name2 = p.name;
    if (p.isVirtual) {
      return false;
    }
    if (!has(element, name2)) {
      return false;
    }
    var value = element[name2];
    if (value === p.default) {
      return false;
    }
    if (value === null) {
      return false;
    }
    return p.isMany ? value.length : true;
  });
}
var ESCAPE_ATTR_MAP = {
  "\n": "#10",
  "\n\r": "#10",
  '"': "#34",
  "'": "#39",
  "<": "#60",
  ">": "#62",
  "&": "#38"
};
var ESCAPE_MAP = {
  "<": "lt",
  ">": "gt",
  "&": "amp"
};
function escape(str, charPattern, replaceMap) {
  str = isString(str) ? str : "" + str;
  return str.replace(charPattern, function(s) {
    return "&" + replaceMap[s] + ";";
  });
}
function escapeAttr(str) {
  return escape(str, ESCAPE_ATTR_CHARS, ESCAPE_ATTR_MAP);
}
function escapeBody(str) {
  return escape(str, ESCAPE_CHARS, ESCAPE_MAP);
}
function filterAttributes(props) {
  return filter(props, function(p) {
    return p.isAttr;
  });
}
function filterContained(props) {
  return filter(props, function(p) {
    return !p.isAttr;
  });
}
function ReferenceSerializer(tagName) {
  this.tagName = tagName;
}
ReferenceSerializer.prototype.build = function(element) {
  this.element = element;
  return this;
};
ReferenceSerializer.prototype.serializeTo = function(writer) {
  writer.appendIndent().append("<" + this.tagName + ">" + this.element.id + "</" + this.tagName + ">").appendNewLine();
};
function BodySerializer() {
}
BodySerializer.prototype.serializeValue = BodySerializer.prototype.serializeTo = function(writer) {
  writer.append(
    this.escape ? escapeBody(this.value) : this.value
  );
};
BodySerializer.prototype.build = function(prop, value) {
  this.value = value;
  if (prop.type === "String" && value.search(ESCAPE_CHARS) !== -1) {
    this.escape = true;
  }
  return this;
};
function ValueSerializer(tagName) {
  this.tagName = tagName;
}
inherits(ValueSerializer, BodySerializer);
ValueSerializer.prototype.serializeTo = function(writer) {
  writer.appendIndent().append("<" + this.tagName + ">");
  this.serializeValue(writer);
  writer.append("</" + this.tagName + ">").appendNewLine();
};
function ElementSerializer(parent, propertyDescriptor) {
  this.body = [];
  this.attrs = [];
  this.parent = parent;
  this.propertyDescriptor = propertyDescriptor;
}
ElementSerializer.prototype.build = function(element) {
  this.element = element;
  var elementDescriptor = element.$descriptor, propertyDescriptor = this.propertyDescriptor;
  var otherAttrs, properties;
  var isGeneric = elementDescriptor.isGeneric;
  if (isGeneric) {
    otherAttrs = this.parseGenericNsAttributes(element);
  } else {
    otherAttrs = this.parseNsAttributes(element);
  }
  if (propertyDescriptor) {
    this.ns = this.nsPropertyTagName(propertyDescriptor);
  } else {
    this.ns = this.nsTagName(elementDescriptor);
  }
  this.tagName = this.addTagName(this.ns);
  if (isGeneric) {
    this.parseGenericContainments(element);
  } else {
    properties = getSerializableProperties(element);
    this.parseAttributes(filterAttributes(properties));
    this.parseContainments(filterContained(properties));
  }
  this.parseGenericAttributes(element, otherAttrs);
  return this;
};
ElementSerializer.prototype.nsTagName = function(descriptor) {
  var effectiveNs = this.logNamespaceUsed(descriptor.ns);
  return getElementNs(effectiveNs, descriptor);
};
ElementSerializer.prototype.nsPropertyTagName = function(descriptor) {
  var effectiveNs = this.logNamespaceUsed(descriptor.ns);
  return getPropertyNs(effectiveNs, descriptor);
};
ElementSerializer.prototype.isLocalNs = function(ns) {
  return ns.uri === this.ns.uri;
};
ElementSerializer.prototype.nsAttributeName = function(element) {
  var ns;
  if (isString(element)) {
    ns = parseName(element);
  } else {
    ns = element.ns;
  }
  if (element.inherited) {
    return { localName: ns.localName };
  }
  var effectiveNs = this.logNamespaceUsed(ns);
  this.getNamespaces().logUsed(effectiveNs);
  if (this.isLocalNs(effectiveNs)) {
    return { localName: ns.localName };
  } else {
    return assign({ localName: ns.localName }, effectiveNs);
  }
};
ElementSerializer.prototype.parseGenericNsAttributes = function(element) {
  return Object.entries(element).filter(
    ([key, value]) => !key.startsWith("$") && this.parseNsAttribute(element, key, value)
  ).map(
    ([key, value]) => ({ name: key, value })
  );
};
ElementSerializer.prototype.parseGenericContainments = function(element) {
  var body = element.$body;
  if (body) {
    this.body.push(new BodySerializer().build({ type: "String" }, body));
  }
  var children = element.$children;
  if (children) {
    forEach(children, (child) => {
      this.body.push(new ElementSerializer(this).build(child));
    });
  }
};
ElementSerializer.prototype.parseNsAttribute = function(element, name2, value) {
  var model = element.$model;
  var nameNs = parseName(name2);
  var ns;
  if (nameNs.prefix === "xmlns") {
    ns = { prefix: nameNs.localName, uri: value };
  }
  if (!nameNs.prefix && nameNs.localName === "xmlns") {
    ns = { uri: value };
  }
  if (!ns) {
    return {
      name: name2,
      value
    };
  }
  if (model && model.getPackage(value)) {
    this.logNamespace(ns, true, true);
  } else {
    var actualNs = this.logNamespaceUsed(ns, true);
    this.getNamespaces().logUsed(actualNs);
  }
};
ElementSerializer.prototype.parseNsAttributes = function(element) {
  var self = this;
  var genericAttrs = element.$attrs;
  var attributes = [];
  forEach(genericAttrs, function(value, name2) {
    var nonNsAttr = self.parseNsAttribute(element, name2, value);
    if (nonNsAttr) {
      attributes.push(nonNsAttr);
    }
  });
  return attributes;
};
ElementSerializer.prototype.parseGenericAttributes = function(element, attributes) {
  var self = this;
  forEach(attributes, function(attr) {
    try {
      self.addAttribute(self.nsAttributeName(attr.name), attr.value);
    } catch (e) {
      typeof console !== "undefined" && console.warn(
        `missing namespace information for <${attr.name}=${attr.value}> on`,
        element,
        e
      );
    }
  });
};
ElementSerializer.prototype.parseContainments = function(properties) {
  var self = this, body = this.body, element = this.element;
  forEach(properties, function(p) {
    var value = element.get(p.name), isReference = p.isReference, isMany = p.isMany;
    if (!isMany) {
      value = [value];
    }
    if (p.isBody) {
      body.push(new BodySerializer().build(p, value[0]));
    } else if (isSimple(p.type)) {
      forEach(value, function(v) {
        body.push(new ValueSerializer(self.addTagName(self.nsPropertyTagName(p))).build(p, v));
      });
    } else if (isReference) {
      forEach(value, function(v) {
        body.push(new ReferenceSerializer(self.addTagName(self.nsPropertyTagName(p))).build(v));
      });
    } else {
      var serialization = getSerialization(p);
      forEach(value, function(v) {
        var serializer;
        if (serialization) {
          if (serialization === SERIALIZE_PROPERTY) {
            serializer = new ElementSerializer(self, p);
          } else {
            serializer = new TypeSerializer(self, p, serialization);
          }
        } else {
          serializer = new ElementSerializer(self);
        }
        body.push(serializer.build(v));
      });
    }
  });
};
ElementSerializer.prototype.getNamespaces = function(local) {
  var namespaces = this.namespaces, parent = this.parent, parentNamespaces;
  if (!namespaces) {
    parentNamespaces = parent && parent.getNamespaces();
    if (local || !parentNamespaces) {
      this.namespaces = namespaces = new Namespaces(parentNamespaces);
    } else {
      namespaces = parentNamespaces;
    }
  }
  return namespaces;
};
ElementSerializer.prototype.logNamespace = function(ns, wellknown, local) {
  var namespaces = this.getNamespaces(local);
  var nsUri = ns.uri, nsPrefix = ns.prefix;
  var existing = namespaces.byUri(nsUri);
  if (!existing || local) {
    namespaces.add(ns, wellknown);
  }
  namespaces.mapPrefix(nsPrefix, nsUri);
  return ns;
};
ElementSerializer.prototype.logNamespaceUsed = function(ns, local) {
  var namespaces = this.getNamespaces(local);
  var prefix2 = ns.prefix, uri2 = ns.uri, newPrefix, idx, wellknownUri;
  if (!prefix2 && !uri2) {
    return { localName: ns.localName };
  }
  wellknownUri = namespaces.defaultUriByPrefix(prefix2);
  uri2 = uri2 || wellknownUri || namespaces.uriByPrefix(prefix2);
  if (!uri2) {
    throw new Error("no namespace uri given for prefix <" + prefix2 + ">");
  }
  ns = namespaces.byUri(uri2);
  if (!ns && !prefix2) {
    ns = this.logNamespace({ uri: uri2 }, wellknownUri === uri2, true);
  }
  if (!ns) {
    newPrefix = prefix2;
    idx = 1;
    while (namespaces.uriByPrefix(newPrefix)) {
      newPrefix = prefix2 + "_" + idx++;
    }
    ns = this.logNamespace({ prefix: newPrefix, uri: uri2 }, wellknownUri === uri2);
  }
  if (prefix2) {
    namespaces.mapPrefix(prefix2, uri2);
  }
  return ns;
};
ElementSerializer.prototype.parseAttributes = function(properties) {
  var self = this, element = this.element;
  forEach(properties, function(p) {
    var value = element.get(p.name);
    if (p.isReference) {
      if (!p.isMany) {
        value = value.id;
      } else {
        var values = [];
        forEach(value, function(v) {
          values.push(v.id);
        });
        value = values.join(" ");
      }
    }
    self.addAttribute(self.nsAttributeName(p), value);
  });
};
ElementSerializer.prototype.addTagName = function(nsTagName) {
  var actualNs = this.logNamespaceUsed(nsTagName);
  this.getNamespaces().logUsed(actualNs);
  return nsName(nsTagName);
};
ElementSerializer.prototype.addAttribute = function(name2, value) {
  var attrs = this.attrs;
  if (isString(value)) {
    value = escapeAttr(value);
  }
  var idx = findIndex(attrs, function(element) {
    return element.name.localName === name2.localName && element.name.uri === name2.uri && element.name.prefix === name2.prefix;
  });
  var attr = { name: name2, value };
  if (idx !== -1) {
    attrs.splice(idx, 1, attr);
  } else {
    attrs.push(attr);
  }
};
ElementSerializer.prototype.serializeAttributes = function(writer) {
  var attrs = this.attrs, namespaces = this.namespaces;
  if (namespaces) {
    attrs = getNsAttrs(namespaces).concat(attrs);
  }
  forEach(attrs, function(a) {
    writer.append(" ").append(nsName(a.name)).append('="').append(a.value).append('"');
  });
};
ElementSerializer.prototype.serializeTo = function(writer) {
  var firstBody = this.body[0], indent = firstBody && firstBody.constructor !== BodySerializer;
  writer.appendIndent().append("<" + this.tagName);
  this.serializeAttributes(writer);
  writer.append(firstBody ? ">" : " />");
  if (firstBody) {
    if (indent) {
      writer.appendNewLine().indent();
    }
    forEach(this.body, function(b) {
      b.serializeTo(writer);
    });
    if (indent) {
      writer.unindent().appendIndent();
    }
    writer.append("</" + this.tagName + ">");
  }
  writer.appendNewLine();
};
function TypeSerializer(parent, propertyDescriptor, serialization) {
  ElementSerializer.call(this, parent, propertyDescriptor);
  this.serialization = serialization;
}
inherits(TypeSerializer, ElementSerializer);
TypeSerializer.prototype.parseNsAttributes = function(element) {
  var attributes = ElementSerializer.prototype.parseNsAttributes.call(this, element).filter(
    (attr) => attr.name !== this.serialization
  );
  var descriptor = element.$descriptor;
  if (descriptor.name === this.propertyDescriptor.type) {
    return attributes;
  }
  var typeNs = this.typeNs = this.nsTagName(descriptor);
  this.getNamespaces().logUsed(this.typeNs);
  var pkg = element.$model.getPackage(typeNs.uri), typePrefix = pkg.xml && pkg.xml.typePrefix || "";
  this.addAttribute(
    this.nsAttributeName(this.serialization),
    (typeNs.prefix ? typeNs.prefix + ":" : "") + typePrefix + descriptor.ns.localName
  );
  return attributes;
};
TypeSerializer.prototype.isLocalNs = function(ns) {
  return ns.uri === (this.typeNs || this.ns).uri;
};
function SavingWriter() {
  this.value = "";
  this.write = function(str) {
    this.value += str;
  };
}
function FormatingWriter(out, format) {
  var indent = [""];
  this.append = function(str) {
    out.write(str);
    return this;
  };
  this.appendNewLine = function() {
    if (format) {
      out.write("\n");
    }
    return this;
  };
  this.appendIndent = function() {
    if (format) {
      out.write(indent.join("  "));
    }
    return this;
  };
  this.indent = function() {
    indent.push("");
    return this;
  };
  this.unindent = function() {
    indent.pop();
    return this;
  };
}
function Writer(options) {
  options = assign({ format: false, preamble: true }, options || {});
  function toXML(tree, writer) {
    var internalWriter = writer || new SavingWriter();
    var formatingWriter = new FormatingWriter(internalWriter, options.format);
    if (options.preamble) {
      formatingWriter.append(XML_PREAMBLE);
    }
    var serializer = new ElementSerializer();
    var model = tree.$model;
    serializer.getNamespaces().mapDefaultPrefixes(getDefaultPrefixMappings(model));
    serializer.build(tree).serializeTo(formatingWriter);
    if (!writer) {
      return internalWriter.value;
    }
  }
  return {
    toXML
  };
}
function getDefaultPrefixMappings(model) {
  const nsMap = model.config && model.config.nsMap || {};
  const prefixMap = {};
  for (const prefix2 in DEFAULT_NS_MAP) {
    prefixMap[prefix2] = DEFAULT_NS_MAP[prefix2];
  }
  for (const uri2 in nsMap) {
    const prefix2 = nsMap[uri2];
    prefixMap[prefix2] = uri2;
  }
  for (const pkg of model.getPackages()) {
    prefixMap[pkg.prefix] = pkg.uri;
  }
  return prefixMap;
}

// node_modules/bpmn-moddle/dist/index.js
function BpmnModdle(packages2, options) {
  Moddle.call(this, packages2, options);
}
BpmnModdle.prototype = Object.create(Moddle.prototype);
BpmnModdle.prototype.fromXML = function(xmlStr, typeName, options) {
  if (!isString(typeName)) {
    options = typeName;
    typeName = "bpmn:Definitions";
  }
  var reader = new Reader(assign({ model: this, lax: true }, options));
  var rootHandler = reader.handler(typeName);
  return reader.fromXML(xmlStr, rootHandler);
};
BpmnModdle.prototype.toXML = function(element, options) {
  var writer = new Writer(options);
  return new Promise(function(resolve, reject) {
    try {
      var result = writer.toXML(element);
      return resolve({
        xml: result
      });
    } catch (err) {
      return reject(err);
    }
  });
};
var name$5 = "BPMN20";
var uri$5 = "http://www.omg.org/spec/BPMN/20100524/MODEL";
var prefix$5 = "bpmn";
var associations$5 = [];
var types$5 = [
  {
    name: "Interface",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "operations",
        type: "Operation",
        isMany: true
      },
      {
        name: "implementationRef",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Operation",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "inMessageRef",
        type: "Message",
        isReference: true
      },
      {
        name: "outMessageRef",
        type: "Message",
        isReference: true
      },
      {
        name: "errorRef",
        type: "Error",
        isMany: true,
        isReference: true
      },
      {
        name: "implementationRef",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "EndPoint",
    superClass: [
      "RootElement"
    ]
  },
  {
    name: "Auditing",
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "GlobalTask",
    superClass: [
      "CallableElement"
    ],
    properties: [
      {
        name: "resources",
        type: "ResourceRole",
        isMany: true
      }
    ]
  },
  {
    name: "Monitoring",
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "Performer",
    superClass: [
      "ResourceRole"
    ]
  },
  {
    name: "Process",
    superClass: [
      "FlowElementsContainer",
      "CallableElement"
    ],
    properties: [
      {
        name: "processType",
        type: "ProcessType",
        isAttr: true
      },
      {
        name: "isClosed",
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "auditing",
        type: "Auditing"
      },
      {
        name: "monitoring",
        type: "Monitoring"
      },
      {
        name: "properties",
        type: "Property",
        isMany: true
      },
      {
        name: "laneSets",
        isMany: true,
        replaces: "FlowElementsContainer#laneSets",
        type: "LaneSet"
      },
      {
        name: "flowElements",
        isMany: true,
        replaces: "FlowElementsContainer#flowElements",
        type: "FlowElement"
      },
      {
        name: "artifacts",
        type: "Artifact",
        isMany: true
      },
      {
        name: "resources",
        type: "ResourceRole",
        isMany: true
      },
      {
        name: "correlationSubscriptions",
        type: "CorrelationSubscription",
        isMany: true
      },
      {
        name: "supports",
        type: "Process",
        isMany: true,
        isReference: true
      },
      {
        name: "definitionalCollaborationRef",
        type: "Collaboration",
        isAttr: true,
        isReference: true
      },
      {
        name: "isExecutable",
        isAttr: true,
        type: "Boolean"
      }
    ]
  },
  {
    name: "LaneSet",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "lanes",
        type: "Lane",
        isMany: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Lane",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "partitionElementRef",
        type: "BaseElement",
        isAttr: true,
        isReference: true
      },
      {
        name: "partitionElement",
        type: "BaseElement"
      },
      {
        name: "flowNodeRef",
        type: "FlowNode",
        isMany: true,
        isReference: true
      },
      {
        name: "childLaneSet",
        type: "LaneSet",
        xml: {
          serialize: "xsi:type"
        }
      }
    ]
  },
  {
    name: "GlobalManualTask",
    superClass: [
      "GlobalTask"
    ]
  },
  {
    name: "ManualTask",
    superClass: [
      "Task"
    ]
  },
  {
    name: "UserTask",
    superClass: [
      "Task"
    ],
    properties: [
      {
        name: "renderings",
        type: "Rendering",
        isMany: true
      },
      {
        name: "implementation",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Rendering",
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "HumanPerformer",
    superClass: [
      "Performer"
    ]
  },
  {
    name: "PotentialOwner",
    superClass: [
      "HumanPerformer"
    ]
  },
  {
    name: "GlobalUserTask",
    superClass: [
      "GlobalTask"
    ],
    properties: [
      {
        name: "implementation",
        isAttr: true,
        type: "String"
      },
      {
        name: "renderings",
        type: "Rendering",
        isMany: true
      }
    ]
  },
  {
    name: "Gateway",
    isAbstract: true,
    superClass: [
      "FlowNode"
    ],
    properties: [
      {
        name: "gatewayDirection",
        type: "GatewayDirection",
        "default": "Unspecified",
        isAttr: true
      }
    ]
  },
  {
    name: "EventBasedGateway",
    superClass: [
      "Gateway"
    ],
    properties: [
      {
        name: "instantiate",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "eventGatewayType",
        type: "EventBasedGatewayType",
        isAttr: true,
        "default": "Exclusive"
      }
    ]
  },
  {
    name: "ComplexGateway",
    superClass: [
      "Gateway"
    ],
    properties: [
      {
        name: "activationCondition",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "default",
        type: "SequenceFlow",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ExclusiveGateway",
    superClass: [
      "Gateway"
    ],
    properties: [
      {
        name: "default",
        type: "SequenceFlow",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "InclusiveGateway",
    superClass: [
      "Gateway"
    ],
    properties: [
      {
        name: "default",
        type: "SequenceFlow",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ParallelGateway",
    superClass: [
      "Gateway"
    ]
  },
  {
    name: "RootElement",
    isAbstract: true,
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "Relationship",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "type",
        isAttr: true,
        type: "String"
      },
      {
        name: "direction",
        type: "RelationshipDirection",
        isAttr: true
      },
      {
        name: "source",
        isMany: true,
        isReference: true,
        type: "Element"
      },
      {
        name: "target",
        isMany: true,
        isReference: true,
        type: "Element"
      }
    ]
  },
  {
    name: "BaseElement",
    isAbstract: true,
    properties: [
      {
        name: "id",
        isAttr: true,
        type: "String",
        isId: true
      },
      {
        name: "documentation",
        type: "Documentation",
        isMany: true
      },
      {
        name: "extensionDefinitions",
        type: "ExtensionDefinition",
        isMany: true,
        isReference: true
      },
      {
        name: "extensionElements",
        type: "ExtensionElements"
      }
    ]
  },
  {
    name: "Extension",
    properties: [
      {
        name: "mustUnderstand",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "definition",
        type: "ExtensionDefinition",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ExtensionDefinition",
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "extensionAttributeDefinitions",
        type: "ExtensionAttributeDefinition",
        isMany: true
      }
    ]
  },
  {
    name: "ExtensionAttributeDefinition",
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "type",
        isAttr: true,
        type: "String"
      },
      {
        name: "isReference",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "extensionDefinition",
        type: "ExtensionDefinition",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ExtensionElements",
    properties: [
      {
        name: "valueRef",
        isAttr: true,
        isReference: true,
        type: "Element"
      },
      {
        name: "values",
        type: "Element",
        isMany: true
      },
      {
        name: "extensionAttributeDefinition",
        type: "ExtensionAttributeDefinition",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Documentation",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "text",
        type: "String",
        isBody: true
      },
      {
        name: "textFormat",
        "default": "text/plain",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Event",
    isAbstract: true,
    superClass: [
      "FlowNode",
      "InteractionNode"
    ],
    properties: [
      {
        name: "properties",
        type: "Property",
        isMany: true
      }
    ]
  },
  {
    name: "IntermediateCatchEvent",
    superClass: [
      "CatchEvent"
    ]
  },
  {
    name: "IntermediateThrowEvent",
    superClass: [
      "ThrowEvent"
    ]
  },
  {
    name: "EndEvent",
    superClass: [
      "ThrowEvent"
    ]
  },
  {
    name: "StartEvent",
    superClass: [
      "CatchEvent"
    ],
    properties: [
      {
        name: "isInterrupting",
        "default": true,
        isAttr: true,
        type: "Boolean"
      }
    ]
  },
  {
    name: "ThrowEvent",
    isAbstract: true,
    superClass: [
      "Event"
    ],
    properties: [
      {
        name: "dataInputs",
        type: "DataInput",
        isMany: true
      },
      {
        name: "dataInputAssociations",
        type: "DataInputAssociation",
        isMany: true
      },
      {
        name: "inputSet",
        type: "InputSet"
      },
      {
        name: "eventDefinitions",
        type: "EventDefinition",
        isMany: true
      },
      {
        name: "eventDefinitionRef",
        type: "EventDefinition",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "CatchEvent",
    isAbstract: true,
    superClass: [
      "Event"
    ],
    properties: [
      {
        name: "parallelMultiple",
        isAttr: true,
        type: "Boolean",
        "default": false
      },
      {
        name: "dataOutputs",
        type: "DataOutput",
        isMany: true
      },
      {
        name: "dataOutputAssociations",
        type: "DataOutputAssociation",
        isMany: true
      },
      {
        name: "outputSet",
        type: "OutputSet"
      },
      {
        name: "eventDefinitions",
        type: "EventDefinition",
        isMany: true
      },
      {
        name: "eventDefinitionRef",
        type: "EventDefinition",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "BoundaryEvent",
    superClass: [
      "CatchEvent"
    ],
    properties: [
      {
        name: "cancelActivity",
        "default": true,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "attachedToRef",
        type: "Activity",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "EventDefinition",
    isAbstract: true,
    superClass: [
      "RootElement"
    ]
  },
  {
    name: "CancelEventDefinition",
    superClass: [
      "EventDefinition"
    ]
  },
  {
    name: "ErrorEventDefinition",
    superClass: [
      "EventDefinition"
    ],
    properties: [
      {
        name: "errorRef",
        type: "Error",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "TerminateEventDefinition",
    superClass: [
      "EventDefinition"
    ]
  },
  {
    name: "EscalationEventDefinition",
    superClass: [
      "EventDefinition"
    ],
    properties: [
      {
        name: "escalationRef",
        type: "Escalation",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Escalation",
    properties: [
      {
        name: "structureRef",
        type: "ItemDefinition",
        isAttr: true,
        isReference: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "escalationCode",
        isAttr: true,
        type: "String"
      }
    ],
    superClass: [
      "RootElement"
    ]
  },
  {
    name: "CompensateEventDefinition",
    superClass: [
      "EventDefinition"
    ],
    properties: [
      {
        name: "waitForCompletion",
        isAttr: true,
        type: "Boolean",
        "default": true
      },
      {
        name: "activityRef",
        type: "Activity",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "TimerEventDefinition",
    superClass: [
      "EventDefinition"
    ],
    properties: [
      {
        name: "timeDate",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "timeCycle",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "timeDuration",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      }
    ]
  },
  {
    name: "LinkEventDefinition",
    superClass: [
      "EventDefinition"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "target",
        type: "LinkEventDefinition",
        isReference: true
      },
      {
        name: "source",
        type: "LinkEventDefinition",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "MessageEventDefinition",
    superClass: [
      "EventDefinition"
    ],
    properties: [
      {
        name: "messageRef",
        type: "Message",
        isAttr: true,
        isReference: true
      },
      {
        name: "operationRef",
        type: "Operation",
        isReference: true
      }
    ]
  },
  {
    name: "ConditionalEventDefinition",
    superClass: [
      "EventDefinition"
    ],
    properties: [
      {
        name: "condition",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      }
    ]
  },
  {
    name: "SignalEventDefinition",
    superClass: [
      "EventDefinition"
    ],
    properties: [
      {
        name: "signalRef",
        type: "Signal",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Signal",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "structureRef",
        type: "ItemDefinition",
        isAttr: true,
        isReference: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "ImplicitThrowEvent",
    superClass: [
      "ThrowEvent"
    ]
  },
  {
    name: "DataState",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "ItemAwareElement",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "itemSubjectRef",
        type: "ItemDefinition",
        isAttr: true,
        isReference: true
      },
      {
        name: "dataState",
        type: "DataState"
      }
    ]
  },
  {
    name: "DataAssociation",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "sourceRef",
        type: "ItemAwareElement",
        isMany: true,
        isReference: true
      },
      {
        name: "targetRef",
        type: "ItemAwareElement",
        isReference: true
      },
      {
        name: "transformation",
        type: "FormalExpression",
        xml: {
          serialize: "property"
        }
      },
      {
        name: "assignment",
        type: "Assignment",
        isMany: true
      }
    ]
  },
  {
    name: "DataInput",
    superClass: [
      "ItemAwareElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "isCollection",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "inputSetRef",
        type: "InputSet",
        isMany: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "inputSetWithOptional",
        type: "InputSet",
        isMany: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "inputSetWithWhileExecuting",
        type: "InputSet",
        isMany: true,
        isVirtual: true,
        isReference: true
      }
    ]
  },
  {
    name: "DataOutput",
    superClass: [
      "ItemAwareElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "isCollection",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "outputSetRef",
        type: "OutputSet",
        isMany: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "outputSetWithOptional",
        type: "OutputSet",
        isMany: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "outputSetWithWhileExecuting",
        type: "OutputSet",
        isMany: true,
        isVirtual: true,
        isReference: true
      }
    ]
  },
  {
    name: "InputSet",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "dataInputRefs",
        type: "DataInput",
        isMany: true,
        isReference: true
      },
      {
        name: "optionalInputRefs",
        type: "DataInput",
        isMany: true,
        isReference: true
      },
      {
        name: "whileExecutingInputRefs",
        type: "DataInput",
        isMany: true,
        isReference: true
      },
      {
        name: "outputSetRefs",
        type: "OutputSet",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "OutputSet",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "dataOutputRefs",
        type: "DataOutput",
        isMany: true,
        isReference: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "inputSetRefs",
        type: "InputSet",
        isMany: true,
        isReference: true
      },
      {
        name: "optionalOutputRefs",
        type: "DataOutput",
        isMany: true,
        isReference: true
      },
      {
        name: "whileExecutingOutputRefs",
        type: "DataOutput",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "Property",
    superClass: [
      "ItemAwareElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "DataInputAssociation",
    superClass: [
      "DataAssociation"
    ]
  },
  {
    name: "DataOutputAssociation",
    superClass: [
      "DataAssociation"
    ]
  },
  {
    name: "InputOutputSpecification",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "dataInputs",
        type: "DataInput",
        isMany: true
      },
      {
        name: "dataOutputs",
        type: "DataOutput",
        isMany: true
      },
      {
        name: "inputSets",
        type: "InputSet",
        isMany: true
      },
      {
        name: "outputSets",
        type: "OutputSet",
        isMany: true
      }
    ]
  },
  {
    name: "DataObject",
    superClass: [
      "FlowElement",
      "ItemAwareElement"
    ],
    properties: [
      {
        name: "isCollection",
        "default": false,
        isAttr: true,
        type: "Boolean"
      }
    ]
  },
  {
    name: "InputOutputBinding",
    properties: [
      {
        name: "inputDataRef",
        type: "InputSet",
        isAttr: true,
        isReference: true
      },
      {
        name: "outputDataRef",
        type: "OutputSet",
        isAttr: true,
        isReference: true
      },
      {
        name: "operationRef",
        type: "Operation",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Assignment",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "from",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "to",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      }
    ]
  },
  {
    name: "DataStore",
    superClass: [
      "RootElement",
      "ItemAwareElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "capacity",
        isAttr: true,
        type: "Integer"
      },
      {
        name: "isUnlimited",
        "default": true,
        isAttr: true,
        type: "Boolean"
      }
    ]
  },
  {
    name: "DataStoreReference",
    superClass: [
      "ItemAwareElement",
      "FlowElement"
    ],
    properties: [
      {
        name: "dataStoreRef",
        type: "DataStore",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "DataObjectReference",
    superClass: [
      "ItemAwareElement",
      "FlowElement"
    ],
    properties: [
      {
        name: "dataObjectRef",
        type: "DataObject",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ConversationLink",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "sourceRef",
        type: "InteractionNode",
        isAttr: true,
        isReference: true
      },
      {
        name: "targetRef",
        type: "InteractionNode",
        isAttr: true,
        isReference: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "ConversationAssociation",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "innerConversationNodeRef",
        type: "ConversationNode",
        isAttr: true,
        isReference: true
      },
      {
        name: "outerConversationNodeRef",
        type: "ConversationNode",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "CallConversation",
    superClass: [
      "ConversationNode"
    ],
    properties: [
      {
        name: "calledCollaborationRef",
        type: "Collaboration",
        isAttr: true,
        isReference: true
      },
      {
        name: "participantAssociations",
        type: "ParticipantAssociation",
        isMany: true
      }
    ]
  },
  {
    name: "Conversation",
    superClass: [
      "ConversationNode"
    ]
  },
  {
    name: "SubConversation",
    superClass: [
      "ConversationNode"
    ],
    properties: [
      {
        name: "conversationNodes",
        type: "ConversationNode",
        isMany: true
      }
    ]
  },
  {
    name: "ConversationNode",
    isAbstract: true,
    superClass: [
      "InteractionNode",
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "participantRef",
        type: "Participant",
        isMany: true,
        isReference: true
      },
      {
        name: "messageFlowRefs",
        type: "MessageFlow",
        isMany: true,
        isReference: true
      },
      {
        name: "correlationKeys",
        type: "CorrelationKey",
        isMany: true
      }
    ]
  },
  {
    name: "GlobalConversation",
    superClass: [
      "Collaboration"
    ]
  },
  {
    name: "PartnerEntity",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "participantRef",
        type: "Participant",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "PartnerRole",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "participantRef",
        type: "Participant",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "CorrelationProperty",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "correlationPropertyRetrievalExpression",
        type: "CorrelationPropertyRetrievalExpression",
        isMany: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "type",
        type: "ItemDefinition",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Error",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "structureRef",
        type: "ItemDefinition",
        isAttr: true,
        isReference: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "errorCode",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "CorrelationKey",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "correlationPropertyRef",
        type: "CorrelationProperty",
        isMany: true,
        isReference: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Expression",
    superClass: [
      "BaseElement"
    ],
    isAbstract: false,
    properties: [
      {
        name: "body",
        isBody: true,
        type: "String"
      }
    ]
  },
  {
    name: "FormalExpression",
    superClass: [
      "Expression"
    ],
    properties: [
      {
        name: "language",
        isAttr: true,
        type: "String"
      },
      {
        name: "evaluatesToTypeRef",
        type: "ItemDefinition",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Message",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "itemRef",
        type: "ItemDefinition",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ItemDefinition",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "itemKind",
        type: "ItemKind",
        isAttr: true
      },
      {
        name: "structureRef",
        isAttr: true,
        type: "String"
      },
      {
        name: "isCollection",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "import",
        type: "Import",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "FlowElement",
    isAbstract: true,
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "auditing",
        type: "Auditing"
      },
      {
        name: "monitoring",
        type: "Monitoring"
      },
      {
        name: "categoryValueRef",
        type: "CategoryValue",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "SequenceFlow",
    superClass: [
      "FlowElement"
    ],
    properties: [
      {
        name: "isImmediate",
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "conditionExpression",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "sourceRef",
        type: "FlowNode",
        isAttr: true,
        isReference: true
      },
      {
        name: "targetRef",
        type: "FlowNode",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "FlowElementsContainer",
    isAbstract: true,
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "laneSets",
        type: "LaneSet",
        isMany: true
      },
      {
        name: "flowElements",
        type: "FlowElement",
        isMany: true
      }
    ]
  },
  {
    name: "CallableElement",
    isAbstract: true,
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "ioSpecification",
        type: "InputOutputSpecification",
        xml: {
          serialize: "property"
        }
      },
      {
        name: "supportedInterfaceRef",
        type: "Interface",
        isMany: true,
        isReference: true
      },
      {
        name: "ioBinding",
        type: "InputOutputBinding",
        isMany: true,
        xml: {
          serialize: "property"
        }
      }
    ]
  },
  {
    name: "FlowNode",
    isAbstract: true,
    superClass: [
      "FlowElement"
    ],
    properties: [
      {
        name: "incoming",
        type: "SequenceFlow",
        isMany: true,
        isReference: true
      },
      {
        name: "outgoing",
        type: "SequenceFlow",
        isMany: true,
        isReference: true
      },
      {
        name: "lanes",
        type: "Lane",
        isMany: true,
        isVirtual: true,
        isReference: true
      }
    ]
  },
  {
    name: "CorrelationPropertyRetrievalExpression",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "messagePath",
        type: "FormalExpression"
      },
      {
        name: "messageRef",
        type: "Message",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "CorrelationPropertyBinding",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "dataPath",
        type: "FormalExpression"
      },
      {
        name: "correlationPropertyRef",
        type: "CorrelationProperty",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Resource",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "resourceParameters",
        type: "ResourceParameter",
        isMany: true
      }
    ]
  },
  {
    name: "ResourceParameter",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "isRequired",
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "type",
        type: "ItemDefinition",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "CorrelationSubscription",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "correlationKeyRef",
        type: "CorrelationKey",
        isAttr: true,
        isReference: true
      },
      {
        name: "correlationPropertyBinding",
        type: "CorrelationPropertyBinding",
        isMany: true
      }
    ]
  },
  {
    name: "MessageFlow",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "sourceRef",
        type: "InteractionNode",
        isAttr: true,
        isReference: true
      },
      {
        name: "targetRef",
        type: "InteractionNode",
        isAttr: true,
        isReference: true
      },
      {
        name: "messageRef",
        type: "Message",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "MessageFlowAssociation",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "innerMessageFlowRef",
        type: "MessageFlow",
        isAttr: true,
        isReference: true
      },
      {
        name: "outerMessageFlowRef",
        type: "MessageFlow",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "InteractionNode",
    isAbstract: true,
    properties: [
      {
        name: "incomingConversationLinks",
        type: "ConversationLink",
        isMany: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "outgoingConversationLinks",
        type: "ConversationLink",
        isMany: true,
        isVirtual: true,
        isReference: true
      }
    ]
  },
  {
    name: "Participant",
    superClass: [
      "InteractionNode",
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "interfaceRef",
        type: "Interface",
        isMany: true,
        isReference: true
      },
      {
        name: "participantMultiplicity",
        type: "ParticipantMultiplicity"
      },
      {
        name: "endPointRefs",
        type: "EndPoint",
        isMany: true,
        isReference: true
      },
      {
        name: "processRef",
        type: "Process",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ParticipantAssociation",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "innerParticipantRef",
        type: "Participant",
        isAttr: true,
        isReference: true
      },
      {
        name: "outerParticipantRef",
        type: "Participant",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ParticipantMultiplicity",
    properties: [
      {
        name: "minimum",
        "default": 0,
        isAttr: true,
        type: "Integer"
      },
      {
        name: "maximum",
        "default": 1,
        isAttr: true,
        type: "Integer"
      }
    ],
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "Collaboration",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "isClosed",
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "participants",
        type: "Participant",
        isMany: true
      },
      {
        name: "messageFlows",
        type: "MessageFlow",
        isMany: true
      },
      {
        name: "artifacts",
        type: "Artifact",
        isMany: true
      },
      {
        name: "conversations",
        type: "ConversationNode",
        isMany: true
      },
      {
        name: "conversationAssociations",
        type: "ConversationAssociation"
      },
      {
        name: "participantAssociations",
        type: "ParticipantAssociation",
        isMany: true
      },
      {
        name: "messageFlowAssociations",
        type: "MessageFlowAssociation",
        isMany: true
      },
      {
        name: "correlationKeys",
        type: "CorrelationKey",
        isMany: true
      },
      {
        name: "choreographyRef",
        type: "Choreography",
        isMany: true,
        isReference: true
      },
      {
        name: "conversationLinks",
        type: "ConversationLink",
        isMany: true
      }
    ]
  },
  {
    name: "ChoreographyActivity",
    isAbstract: true,
    superClass: [
      "FlowNode"
    ],
    properties: [
      {
        name: "participantRef",
        type: "Participant",
        isMany: true,
        isReference: true
      },
      {
        name: "initiatingParticipantRef",
        type: "Participant",
        isAttr: true,
        isReference: true
      },
      {
        name: "correlationKeys",
        type: "CorrelationKey",
        isMany: true
      },
      {
        name: "loopType",
        type: "ChoreographyLoopType",
        "default": "None",
        isAttr: true
      }
    ]
  },
  {
    name: "CallChoreography",
    superClass: [
      "ChoreographyActivity"
    ],
    properties: [
      {
        name: "calledChoreographyRef",
        type: "Choreography",
        isAttr: true,
        isReference: true
      },
      {
        name: "participantAssociations",
        type: "ParticipantAssociation",
        isMany: true
      }
    ]
  },
  {
    name: "SubChoreography",
    superClass: [
      "ChoreographyActivity",
      "FlowElementsContainer"
    ],
    properties: [
      {
        name: "artifacts",
        type: "Artifact",
        isMany: true
      }
    ]
  },
  {
    name: "ChoreographyTask",
    superClass: [
      "ChoreographyActivity"
    ],
    properties: [
      {
        name: "messageFlowRef",
        type: "MessageFlow",
        isMany: true,
        isReference: true
      }
    ]
  },
  {
    name: "Choreography",
    superClass: [
      "Collaboration",
      "FlowElementsContainer"
    ]
  },
  {
    name: "GlobalChoreographyTask",
    superClass: [
      "Choreography"
    ],
    properties: [
      {
        name: "initiatingParticipantRef",
        type: "Participant",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "TextAnnotation",
    superClass: [
      "Artifact"
    ],
    properties: [
      {
        name: "text",
        type: "String"
      },
      {
        name: "textFormat",
        "default": "text/plain",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Group",
    superClass: [
      "Artifact"
    ],
    properties: [
      {
        name: "categoryValueRef",
        type: "CategoryValue",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Association",
    superClass: [
      "Artifact"
    ],
    properties: [
      {
        name: "associationDirection",
        type: "AssociationDirection",
        isAttr: true
      },
      {
        name: "sourceRef",
        type: "BaseElement",
        isAttr: true,
        isReference: true
      },
      {
        name: "targetRef",
        type: "BaseElement",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "Category",
    superClass: [
      "RootElement"
    ],
    properties: [
      {
        name: "categoryValue",
        type: "CategoryValue",
        isMany: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Artifact",
    isAbstract: true,
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "CategoryValue",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "categorizedFlowElements",
        type: "FlowElement",
        isMany: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "value",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Activity",
    isAbstract: true,
    superClass: [
      "FlowNode"
    ],
    properties: [
      {
        name: "isForCompensation",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "default",
        type: "SequenceFlow",
        isAttr: true,
        isReference: true
      },
      {
        name: "ioSpecification",
        type: "InputOutputSpecification",
        xml: {
          serialize: "property"
        }
      },
      {
        name: "boundaryEventRefs",
        type: "BoundaryEvent",
        isMany: true,
        isReference: true
      },
      {
        name: "properties",
        type: "Property",
        isMany: true
      },
      {
        name: "dataInputAssociations",
        type: "DataInputAssociation",
        isMany: true
      },
      {
        name: "dataOutputAssociations",
        type: "DataOutputAssociation",
        isMany: true
      },
      {
        name: "startQuantity",
        "default": 1,
        isAttr: true,
        type: "Integer"
      },
      {
        name: "resources",
        type: "ResourceRole",
        isMany: true
      },
      {
        name: "completionQuantity",
        "default": 1,
        isAttr: true,
        type: "Integer"
      },
      {
        name: "loopCharacteristics",
        type: "LoopCharacteristics"
      }
    ]
  },
  {
    name: "ServiceTask",
    superClass: [
      "Task"
    ],
    properties: [
      {
        name: "implementation",
        isAttr: true,
        type: "String"
      },
      {
        name: "operationRef",
        type: "Operation",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "SubProcess",
    superClass: [
      "Activity",
      "FlowElementsContainer",
      "InteractionNode"
    ],
    properties: [
      {
        name: "triggeredByEvent",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "artifacts",
        type: "Artifact",
        isMany: true
      }
    ]
  },
  {
    name: "LoopCharacteristics",
    isAbstract: true,
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "MultiInstanceLoopCharacteristics",
    superClass: [
      "LoopCharacteristics"
    ],
    properties: [
      {
        name: "isSequential",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "behavior",
        type: "MultiInstanceBehavior",
        "default": "All",
        isAttr: true
      },
      {
        name: "loopCardinality",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "loopDataInputRef",
        type: "ItemAwareElement",
        isReference: true
      },
      {
        name: "loopDataOutputRef",
        type: "ItemAwareElement",
        isReference: true
      },
      {
        name: "inputDataItem",
        type: "DataInput",
        xml: {
          serialize: "property"
        }
      },
      {
        name: "outputDataItem",
        type: "DataOutput",
        xml: {
          serialize: "property"
        }
      },
      {
        name: "complexBehaviorDefinition",
        type: "ComplexBehaviorDefinition",
        isMany: true
      },
      {
        name: "completionCondition",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "oneBehaviorEventRef",
        type: "EventDefinition",
        isAttr: true,
        isReference: true
      },
      {
        name: "noneBehaviorEventRef",
        type: "EventDefinition",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "StandardLoopCharacteristics",
    superClass: [
      "LoopCharacteristics"
    ],
    properties: [
      {
        name: "testBefore",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "loopCondition",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "loopMaximum",
        type: "Integer",
        isAttr: true
      }
    ]
  },
  {
    name: "CallActivity",
    superClass: [
      "Activity",
      "InteractionNode"
    ],
    properties: [
      {
        name: "calledElement",
        type: "String",
        isAttr: true
      }
    ]
  },
  {
    name: "Task",
    superClass: [
      "Activity",
      "InteractionNode"
    ]
  },
  {
    name: "SendTask",
    superClass: [
      "Task"
    ],
    properties: [
      {
        name: "implementation",
        isAttr: true,
        type: "String"
      },
      {
        name: "operationRef",
        type: "Operation",
        isAttr: true,
        isReference: true
      },
      {
        name: "messageRef",
        type: "Message",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ReceiveTask",
    superClass: [
      "Task"
    ],
    properties: [
      {
        name: "implementation",
        isAttr: true,
        type: "String"
      },
      {
        name: "instantiate",
        "default": false,
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "operationRef",
        type: "Operation",
        isAttr: true,
        isReference: true
      },
      {
        name: "messageRef",
        type: "Message",
        isAttr: true,
        isReference: true
      }
    ]
  },
  {
    name: "ScriptTask",
    superClass: [
      "Task"
    ],
    properties: [
      {
        name: "scriptFormat",
        isAttr: true,
        type: "String"
      },
      {
        name: "script",
        type: "String"
      }
    ]
  },
  {
    name: "BusinessRuleTask",
    superClass: [
      "Task"
    ],
    properties: [
      {
        name: "implementation",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "AdHocSubProcess",
    superClass: [
      "SubProcess"
    ],
    properties: [
      {
        name: "completionCondition",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "ordering",
        type: "AdHocOrdering",
        isAttr: true
      },
      {
        name: "cancelRemainingInstances",
        "default": true,
        isAttr: true,
        type: "Boolean"
      }
    ]
  },
  {
    name: "Transaction",
    superClass: [
      "SubProcess"
    ],
    properties: [
      {
        name: "protocol",
        isAttr: true,
        type: "String"
      },
      {
        name: "method",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "GlobalScriptTask",
    superClass: [
      "GlobalTask"
    ],
    properties: [
      {
        name: "scriptLanguage",
        isAttr: true,
        type: "String"
      },
      {
        name: "script",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "GlobalBusinessRuleTask",
    superClass: [
      "GlobalTask"
    ],
    properties: [
      {
        name: "implementation",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "ComplexBehaviorDefinition",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "condition",
        type: "FormalExpression"
      },
      {
        name: "event",
        type: "ImplicitThrowEvent"
      }
    ]
  },
  {
    name: "ResourceRole",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "resourceRef",
        type: "Resource",
        isReference: true
      },
      {
        name: "resourceParameterBindings",
        type: "ResourceParameterBinding",
        isMany: true
      },
      {
        name: "resourceAssignmentExpression",
        type: "ResourceAssignmentExpression"
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "ResourceParameterBinding",
    properties: [
      {
        name: "expression",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      },
      {
        name: "parameterRef",
        type: "ResourceParameter",
        isAttr: true,
        isReference: true
      }
    ],
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "ResourceAssignmentExpression",
    properties: [
      {
        name: "expression",
        type: "Expression",
        xml: {
          serialize: "xsi:type"
        }
      }
    ],
    superClass: [
      "BaseElement"
    ]
  },
  {
    name: "Import",
    properties: [
      {
        name: "importType",
        isAttr: true,
        type: "String"
      },
      {
        name: "location",
        isAttr: true,
        type: "String"
      },
      {
        name: "namespace",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "Definitions",
    superClass: [
      "BaseElement"
    ],
    properties: [
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "targetNamespace",
        isAttr: true,
        type: "String"
      },
      {
        name: "expressionLanguage",
        "default": "http://www.w3.org/1999/XPath",
        isAttr: true,
        type: "String"
      },
      {
        name: "typeLanguage",
        "default": "http://www.w3.org/2001/XMLSchema",
        isAttr: true,
        type: "String"
      },
      {
        name: "imports",
        type: "Import",
        isMany: true
      },
      {
        name: "extensions",
        type: "Extension",
        isMany: true
      },
      {
        name: "rootElements",
        type: "RootElement",
        isMany: true
      },
      {
        name: "diagrams",
        isMany: true,
        type: "bpmndi:BPMNDiagram"
      },
      {
        name: "exporter",
        isAttr: true,
        type: "String"
      },
      {
        name: "relationships",
        type: "Relationship",
        isMany: true
      },
      {
        name: "exporterVersion",
        isAttr: true,
        type: "String"
      }
    ]
  }
];
var enumerations$3 = [
  {
    name: "ProcessType",
    literalValues: [
      {
        name: "None"
      },
      {
        name: "Public"
      },
      {
        name: "Private"
      }
    ]
  },
  {
    name: "GatewayDirection",
    literalValues: [
      {
        name: "Unspecified"
      },
      {
        name: "Converging"
      },
      {
        name: "Diverging"
      },
      {
        name: "Mixed"
      }
    ]
  },
  {
    name: "EventBasedGatewayType",
    literalValues: [
      {
        name: "Parallel"
      },
      {
        name: "Exclusive"
      }
    ]
  },
  {
    name: "RelationshipDirection",
    literalValues: [
      {
        name: "None"
      },
      {
        name: "Forward"
      },
      {
        name: "Backward"
      },
      {
        name: "Both"
      }
    ]
  },
  {
    name: "ItemKind",
    literalValues: [
      {
        name: "Physical"
      },
      {
        name: "Information"
      }
    ]
  },
  {
    name: "ChoreographyLoopType",
    literalValues: [
      {
        name: "None"
      },
      {
        name: "Standard"
      },
      {
        name: "MultiInstanceSequential"
      },
      {
        name: "MultiInstanceParallel"
      }
    ]
  },
  {
    name: "AssociationDirection",
    literalValues: [
      {
        name: "None"
      },
      {
        name: "One"
      },
      {
        name: "Both"
      }
    ]
  },
  {
    name: "MultiInstanceBehavior",
    literalValues: [
      {
        name: "None"
      },
      {
        name: "One"
      },
      {
        name: "All"
      },
      {
        name: "Complex"
      }
    ]
  },
  {
    name: "AdHocOrdering",
    literalValues: [
      {
        name: "Parallel"
      },
      {
        name: "Sequential"
      }
    ]
  }
];
var xml$1 = {
  tagAlias: "lowerCase",
  typePrefix: "t"
};
var BpmnPackage = {
  name: name$5,
  uri: uri$5,
  prefix: prefix$5,
  associations: associations$5,
  types: types$5,
  enumerations: enumerations$3,
  xml: xml$1
};
var name$4 = "BPMNDI";
var uri$4 = "http://www.omg.org/spec/BPMN/20100524/DI";
var prefix$4 = "bpmndi";
var types$4 = [
  {
    name: "BPMNDiagram",
    properties: [
      {
        name: "plane",
        type: "BPMNPlane",
        redefines: "di:Diagram#rootElement"
      },
      {
        name: "labelStyle",
        type: "BPMNLabelStyle",
        isMany: true
      }
    ],
    superClass: [
      "di:Diagram"
    ]
  },
  {
    name: "BPMNPlane",
    properties: [
      {
        name: "bpmnElement",
        isAttr: true,
        isReference: true,
        type: "bpmn:BaseElement",
        redefines: "di:DiagramElement#modelElement"
      }
    ],
    superClass: [
      "di:Plane"
    ]
  },
  {
    name: "BPMNShape",
    properties: [
      {
        name: "bpmnElement",
        isAttr: true,
        isReference: true,
        type: "bpmn:BaseElement",
        redefines: "di:DiagramElement#modelElement"
      },
      {
        name: "isHorizontal",
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "isExpanded",
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "isMarkerVisible",
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "label",
        type: "BPMNLabel"
      },
      {
        name: "isMessageVisible",
        isAttr: true,
        type: "Boolean"
      },
      {
        name: "participantBandKind",
        type: "ParticipantBandKind",
        isAttr: true
      },
      {
        name: "choreographyActivityShape",
        type: "BPMNShape",
        isAttr: true,
        isReference: true
      }
    ],
    superClass: [
      "di:LabeledShape"
    ]
  },
  {
    name: "BPMNEdge",
    properties: [
      {
        name: "label",
        type: "BPMNLabel"
      },
      {
        name: "bpmnElement",
        isAttr: true,
        isReference: true,
        type: "bpmn:BaseElement",
        redefines: "di:DiagramElement#modelElement"
      },
      {
        name: "sourceElement",
        isAttr: true,
        isReference: true,
        type: "di:DiagramElement",
        redefines: "di:Edge#source"
      },
      {
        name: "targetElement",
        isAttr: true,
        isReference: true,
        type: "di:DiagramElement",
        redefines: "di:Edge#target"
      },
      {
        name: "messageVisibleKind",
        type: "MessageVisibleKind",
        isAttr: true,
        "default": "initiating"
      }
    ],
    superClass: [
      "di:LabeledEdge"
    ]
  },
  {
    name: "BPMNLabel",
    properties: [
      {
        name: "labelStyle",
        type: "BPMNLabelStyle",
        isAttr: true,
        isReference: true,
        redefines: "di:DiagramElement#style"
      }
    ],
    superClass: [
      "di:Label"
    ]
  },
  {
    name: "BPMNLabelStyle",
    properties: [
      {
        name: "font",
        type: "dc:Font"
      }
    ],
    superClass: [
      "di:Style"
    ]
  }
];
var enumerations$2 = [
  {
    name: "ParticipantBandKind",
    literalValues: [
      {
        name: "top_initiating"
      },
      {
        name: "middle_initiating"
      },
      {
        name: "bottom_initiating"
      },
      {
        name: "top_non_initiating"
      },
      {
        name: "middle_non_initiating"
      },
      {
        name: "bottom_non_initiating"
      }
    ]
  },
  {
    name: "MessageVisibleKind",
    literalValues: [
      {
        name: "initiating"
      },
      {
        name: "non_initiating"
      }
    ]
  }
];
var associations$4 = [];
var BpmnDiPackage = {
  name: name$4,
  uri: uri$4,
  prefix: prefix$4,
  types: types$4,
  enumerations: enumerations$2,
  associations: associations$4
};
var name$3 = "DC";
var uri$3 = "http://www.omg.org/spec/DD/20100524/DC";
var prefix$3 = "dc";
var types$3 = [
  {
    name: "Boolean"
  },
  {
    name: "Integer"
  },
  {
    name: "Real"
  },
  {
    name: "String"
  },
  {
    name: "Font",
    properties: [
      {
        name: "name",
        type: "String",
        isAttr: true
      },
      {
        name: "size",
        type: "Real",
        isAttr: true
      },
      {
        name: "isBold",
        type: "Boolean",
        isAttr: true
      },
      {
        name: "isItalic",
        type: "Boolean",
        isAttr: true
      },
      {
        name: "isUnderline",
        type: "Boolean",
        isAttr: true
      },
      {
        name: "isStrikeThrough",
        type: "Boolean",
        isAttr: true
      }
    ]
  },
  {
    name: "Point",
    properties: [
      {
        name: "x",
        type: "Real",
        "default": "0",
        isAttr: true
      },
      {
        name: "y",
        type: "Real",
        "default": "0",
        isAttr: true
      }
    ]
  },
  {
    name: "Bounds",
    properties: [
      {
        name: "x",
        type: "Real",
        "default": "0",
        isAttr: true
      },
      {
        name: "y",
        type: "Real",
        "default": "0",
        isAttr: true
      },
      {
        name: "width",
        type: "Real",
        isAttr: true
      },
      {
        name: "height",
        type: "Real",
        isAttr: true
      }
    ]
  }
];
var associations$3 = [];
var DcPackage = {
  name: name$3,
  uri: uri$3,
  prefix: prefix$3,
  types: types$3,
  associations: associations$3
};
var name$2 = "DI";
var uri$2 = "http://www.omg.org/spec/DD/20100524/DI";
var prefix$2 = "di";
var types$2 = [
  {
    name: "DiagramElement",
    isAbstract: true,
    properties: [
      {
        name: "id",
        isAttr: true,
        isId: true,
        type: "String"
      },
      {
        name: "extension",
        type: "Extension"
      },
      {
        name: "owningDiagram",
        type: "Diagram",
        isReadOnly: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "owningElement",
        type: "DiagramElement",
        isReadOnly: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "modelElement",
        isReadOnly: true,
        isVirtual: true,
        isReference: true,
        type: "Element"
      },
      {
        name: "style",
        type: "Style",
        isReadOnly: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "ownedElement",
        type: "DiagramElement",
        isReadOnly: true,
        isMany: true,
        isVirtual: true
      }
    ]
  },
  {
    name: "Node",
    isAbstract: true,
    superClass: [
      "DiagramElement"
    ]
  },
  {
    name: "Edge",
    isAbstract: true,
    superClass: [
      "DiagramElement"
    ],
    properties: [
      {
        name: "source",
        type: "DiagramElement",
        isReadOnly: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "target",
        type: "DiagramElement",
        isReadOnly: true,
        isVirtual: true,
        isReference: true
      },
      {
        name: "waypoint",
        isUnique: false,
        isMany: true,
        type: "dc:Point",
        xml: {
          serialize: "xsi:type"
        }
      }
    ]
  },
  {
    name: "Diagram",
    isAbstract: true,
    properties: [
      {
        name: "id",
        isAttr: true,
        isId: true,
        type: "String"
      },
      {
        name: "rootElement",
        type: "DiagramElement",
        isReadOnly: true,
        isVirtual: true
      },
      {
        name: "name",
        isAttr: true,
        type: "String"
      },
      {
        name: "documentation",
        isAttr: true,
        type: "String"
      },
      {
        name: "resolution",
        isAttr: true,
        type: "Real"
      },
      {
        name: "ownedStyle",
        type: "Style",
        isReadOnly: true,
        isMany: true,
        isVirtual: true
      }
    ]
  },
  {
    name: "Shape",
    isAbstract: true,
    superClass: [
      "Node"
    ],
    properties: [
      {
        name: "bounds",
        type: "dc:Bounds"
      }
    ]
  },
  {
    name: "Plane",
    isAbstract: true,
    superClass: [
      "Node"
    ],
    properties: [
      {
        name: "planeElement",
        type: "DiagramElement",
        subsettedProperty: "DiagramElement-ownedElement",
        isMany: true
      }
    ]
  },
  {
    name: "LabeledEdge",
    isAbstract: true,
    superClass: [
      "Edge"
    ],
    properties: [
      {
        name: "ownedLabel",
        type: "Label",
        isReadOnly: true,
        subsettedProperty: "DiagramElement-ownedElement",
        isMany: true,
        isVirtual: true
      }
    ]
  },
  {
    name: "LabeledShape",
    isAbstract: true,
    superClass: [
      "Shape"
    ],
    properties: [
      {
        name: "ownedLabel",
        type: "Label",
        isReadOnly: true,
        subsettedProperty: "DiagramElement-ownedElement",
        isMany: true,
        isVirtual: true
      }
    ]
  },
  {
    name: "Label",
    isAbstract: true,
    superClass: [
      "Node"
    ],
    properties: [
      {
        name: "bounds",
        type: "dc:Bounds"
      }
    ]
  },
  {
    name: "Style",
    isAbstract: true,
    properties: [
      {
        name: "id",
        isAttr: true,
        isId: true,
        type: "String"
      }
    ]
  },
  {
    name: "Extension",
    properties: [
      {
        name: "values",
        isMany: true,
        type: "Element"
      }
    ]
  }
];
var associations$2 = [];
var xml = {
  tagAlias: "lowerCase"
};
var DiPackage = {
  name: name$2,
  uri: uri$2,
  prefix: prefix$2,
  types: types$2,
  associations: associations$2,
  xml
};
var name$1 = "bpmn.io colors for BPMN";
var uri$1 = "http://bpmn.io/schema/bpmn/biocolor/1.0";
var prefix$1 = "bioc";
var types$1 = [
  {
    name: "ColoredShape",
    "extends": [
      "bpmndi:BPMNShape"
    ],
    properties: [
      {
        name: "stroke",
        isAttr: true,
        type: "String"
      },
      {
        name: "fill",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "ColoredEdge",
    "extends": [
      "bpmndi:BPMNEdge"
    ],
    properties: [
      {
        name: "stroke",
        isAttr: true,
        type: "String"
      },
      {
        name: "fill",
        isAttr: true,
        type: "String"
      }
    ]
  }
];
var enumerations$1 = [];
var associations$1 = [];
var BiocPackage = {
  name: name$1,
  uri: uri$1,
  prefix: prefix$1,
  types: types$1,
  enumerations: enumerations$1,
  associations: associations$1
};
var name = "BPMN in Color";
var uri = "http://www.omg.org/spec/BPMN/non-normative/color/1.0";
var prefix = "color";
var types = [
  {
    name: "ColoredLabel",
    "extends": [
      "bpmndi:BPMNLabel"
    ],
    properties: [
      {
        name: "color",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "ColoredShape",
    "extends": [
      "bpmndi:BPMNShape"
    ],
    properties: [
      {
        name: "background-color",
        isAttr: true,
        type: "String"
      },
      {
        name: "border-color",
        isAttr: true,
        type: "String"
      }
    ]
  },
  {
    name: "ColoredEdge",
    "extends": [
      "bpmndi:BPMNEdge"
    ],
    properties: [
      {
        name: "border-color",
        isAttr: true,
        type: "String"
      }
    ]
  }
];
var enumerations = [];
var associations = [];
var BpmnInColorPackage = {
  name,
  uri,
  prefix,
  types,
  enumerations,
  associations
};
var packages = {
  bpmn: BpmnPackage,
  bpmndi: BpmnDiPackage,
  dc: DcPackage,
  di: DiPackage,
  bioc: BiocPackage,
  color: BpmnInColorPackage
};
function SimpleBpmnModdle(additionalPackages, options) {
  const pks = assign({}, packages, additionalPackages);
  return new BpmnModdle(pks, options);
}

// node_modules/bpmn-auto-layout/dist/index.js
function isConnection(element) {
  return !!element.sourceRef;
}
function isBoundaryEvent(element) {
  return !!element.attachedToRef;
}
function findElementInTree(currentElement, targetElement, visited = /* @__PURE__ */ new Set()) {
  if (currentElement === targetElement) return true;
  if (visited.has(currentElement)) return false;
  visited.add(currentElement);
  if (!currentElement.outgoing || currentElement.outgoing.length === 0) return false;
  for (let nextElement of currentElement.outgoing.map((out) => out.targetRef)) {
    if (findElementInTree(nextElement, targetElement, visited)) {
      return true;
    }
  }
  return false;
}
var DEFAULT_TASK_HEIGHT = 80;
var DEFAULT_TASK_WIDTH = 100;
function getDefaultSize(element) {
  if (is(element, "bpmn:SubProcess")) {
    return { width: DEFAULT_TASK_WIDTH, height: DEFAULT_TASK_HEIGHT };
  }
  if (is(element, "bpmn:Task")) {
    return { width: DEFAULT_TASK_WIDTH, height: DEFAULT_TASK_HEIGHT };
  }
  if (is(element, "bpmn:Gateway")) {
    return { width: 50, height: 50 };
  }
  if (is(element, "bpmn:Event")) {
    return { width: 36, height: 36 };
  }
  if (is(element, "bpmn:Participant")) {
    return { width: 400, height: 100 };
  }
  if (is(element, "bpmn:Lane")) {
    return { width: 400, height: 100 };
  }
  if (is(element, "bpmn:DataObjectReference")) {
    return { width: 36, height: 50 };
  }
  if (is(element, "bpmn:DataStoreReference")) {
    return { width: 50, height: 50 };
  }
  if (is(element, "bpmn:TextAnnotation")) {
    return { width: DEFAULT_TASK_WIDTH, height: 30 };
  }
  return { width: DEFAULT_TASK_WIDTH, height: DEFAULT_TASK_HEIGHT };
}
function is(element, type) {
  return element.$instanceOf(type);
}
var DEFAULT_CELL_WIDTH = 150;
var DEFAULT_CELL_HEIGHT = 140;
function getMid(bounds) {
  return {
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2
  };
}
function getDockingPoint(point, rectangle, dockingDirection = "r", targetOrientation = "top-left") {
  if (dockingDirection === "h") {
    dockingDirection = /left/.test(targetOrientation) ? "l" : "r";
  }
  if (dockingDirection === "v") {
    dockingDirection = /top/.test(targetOrientation) ? "t" : "b";
  }
  if (dockingDirection === "t") {
    return { original: point, x: point.x, y: rectangle.y };
  }
  if (dockingDirection === "r") {
    return { original: point, x: rectangle.x + rectangle.width, y: point.y };
  }
  if (dockingDirection === "b") {
    return { original: point, x: point.x, y: rectangle.y + rectangle.height };
  }
  if (dockingDirection === "l") {
    return { original: point, x: rectangle.x, y: point.y };
  }
  throw new Error("unexpected dockingDirection: <" + dockingDirection + ">");
}
function connectElements(source, target, layoutGrid) {
  const sourceDi = source.di;
  const targetDi = target.di;
  const sourceBounds = sourceDi.get("bounds");
  const targetBounds = targetDi.get("bounds");
  const sourceMid = getMid(sourceBounds);
  const targetMid = getMid(targetBounds);
  const dX = target.gridPosition.col - source.gridPosition.col;
  const dY = target.gridPosition.row - source.gridPosition.row;
  const dockingSource = `${dY > 0 ? "bottom" : "top"}-${dX > 0 ? "right" : "left"}`;
  const dockingTarget = `${dY > 0 ? "top" : "bottom"}-${dX > 0 ? "left" : "right"}`;
  const baseSourceGrid = source.grid || source.attachedToRef?.grid;
  const baseTargetGrid = target.grid;
  if (dX === 0 && dY === 0) {
    const { x, y } = coordinatesToPosition(source.gridPosition.row, source.gridPosition.col);
    return [
      getDockingPoint(sourceMid, sourceBounds, "r", dockingSource),
      { x: baseSourceGrid ? x + (baseSourceGrid.getGridDimensions()[1] + 1) * DEFAULT_CELL_WIDTH : x + DEFAULT_CELL_WIDTH, y: sourceMid.y },
      { x: baseSourceGrid ? x + (baseSourceGrid.getGridDimensions()[1] + 1) * DEFAULT_CELL_WIDTH : x + DEFAULT_CELL_WIDTH, y },
      { x: targetMid.x, y },
      getDockingPoint(targetMid, targetBounds, "t", dockingTarget)
    ];
  }
  if (dX < 0) {
    const { y } = coordinatesToPosition(source.gridPosition.row, source.gridPosition.col);
    const offsetY = DEFAULT_CELL_HEIGHT / 2;
    if (sourceMid.y >= targetMid.y) {
      const maxExpanded = getMaxExpandedBetween(source, target, layoutGrid);
      if (maxExpanded) {
        return [
          getDockingPoint(sourceMid, sourceBounds, "b"),
          { x: sourceMid.x, y: !baseSourceGrid ? y + DEFAULT_CELL_HEIGHT + maxExpanded * DEFAULT_CELL_HEIGHT : y + (baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
          { x: targetMid.x, y: !baseSourceGrid ? y + DEFAULT_CELL_HEIGHT + maxExpanded * DEFAULT_CELL_HEIGHT : y + (baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
          getDockingPoint(targetMid, targetBounds, "b")
        ];
      }
      return [
        getDockingPoint(sourceMid, sourceBounds, "b"),
        { x: sourceMid.x, y: !baseSourceGrid ? y + DEFAULT_CELL_HEIGHT : y + (baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
        { x: targetMid.x, y: !baseSourceGrid ? y + DEFAULT_CELL_HEIGHT : y + (baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
        getDockingPoint(targetMid, targetBounds, "b")
      ];
    } else {
      const bendY = sourceMid.y - offsetY;
      return [
        getDockingPoint(sourceMid, sourceBounds, "t"),
        { x: sourceMid.x, y: bendY },
        { x: targetMid.x, y: bendY },
        getDockingPoint(targetMid, targetBounds, "t")
      ];
    }
  }
  if (dY === 0) {
    if (isDirectPathBlocked(source, target, layoutGrid)) {
      const { y } = coordinatesToPosition(source.gridPosition.row, source.gridPosition.col);
      return [
        getDockingPoint(sourceMid, sourceBounds, "b"),
        { x: sourceMid.x, y: !baseSourceGrid ? y + DEFAULT_CELL_HEIGHT : y + (baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
        { x: targetMid.x, y: !baseSourceGrid ? y + DEFAULT_CELL_HEIGHT : y + (baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
        getDockingPoint(targetMid, targetBounds, "b")
      ];
    } else {
      const firstPoint = getDockingPoint(sourceMid, sourceBounds, "h", dockingSource);
      const lastPoint = getDockingPoint(targetMid, targetBounds, "h", dockingTarget);
      if (baseSourceGrid) {
        firstPoint.y = sourceBounds.y + DEFAULT_TASK_HEIGHT / 2;
      }
      if (baseTargetGrid) {
        lastPoint.y = targetBounds.y + DEFAULT_TASK_HEIGHT / 2;
      }
      return [
        firstPoint,
        lastPoint
      ];
    }
  }
  if (dX === 0) {
    if (isDirectPathBlocked(source, target, layoutGrid)) {
      const yOffset2 = -Math.sign(dY) * DEFAULT_CELL_HEIGHT / 2;
      return [
        getDockingPoint(sourceMid, sourceBounds, "r"),
        { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y },
        // out right
        { x: targetMid.x + DEFAULT_CELL_WIDTH / 2, y: targetMid.y + yOffset2 },
        { x: targetMid.x, y: targetMid.y + yOffset2 },
        getDockingPoint(targetMid, targetBounds, Math.sign(yOffset2) > 0 ? "b" : "t")
      ];
    } else {
      return [
        getDockingPoint(sourceMid, sourceBounds, "v", dockingSource),
        getDockingPoint(targetMid, targetBounds, "v", dockingTarget)
      ];
    }
  }
  const directManhattan = directManhattanConnect(source, target, layoutGrid);
  if (directManhattan) {
    const startPoint = getDockingPoint(sourceMid, sourceBounds, directManhattan[0], dockingSource);
    const endPoint = getDockingPoint(targetMid, targetBounds, directManhattan[1], dockingTarget);
    const midPoint = directManhattan[0] === "h" ? { x: endPoint.x, y: startPoint.y } : { x: startPoint.x, y: endPoint.y };
    return [
      startPoint,
      midPoint,
      endPoint
    ];
  }
  const yOffset = -Math.sign(dY) * DEFAULT_CELL_HEIGHT / 2;
  return [
    getDockingPoint(sourceMid, sourceBounds, "r", dockingSource),
    { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: sourceMid.y },
    // out right
    { x: sourceMid.x + DEFAULT_CELL_WIDTH / 2, y: targetMid.y + yOffset },
    // to target row
    { x: targetMid.x - DEFAULT_CELL_WIDTH / 2, y: targetMid.y + yOffset },
    // to target column
    { x: targetMid.x - DEFAULT_CELL_WIDTH / 2, y: targetMid.y },
    // to mid
    getDockingPoint(targetMid, targetBounds, "l", dockingTarget)
  ];
}
function coordinatesToPosition(row, col) {
  return {
    width: DEFAULT_CELL_WIDTH,
    height: DEFAULT_CELL_HEIGHT,
    x: col * DEFAULT_CELL_WIDTH,
    y: row * DEFAULT_CELL_HEIGHT
  };
}
function getBounds(element, row, col, shift, attachedTo) {
  let { width, height } = getDefaultSize(element);
  const { x, y } = shift;
  if (!attachedTo) {
    return {
      width: element.isExpanded ? element.grid.getGridDimensions()[1] * DEFAULT_CELL_WIDTH + width : width,
      height: element.isExpanded ? element.grid.getGridDimensions()[0] * DEFAULT_CELL_HEIGHT + height : height,
      x: col * DEFAULT_CELL_WIDTH + (DEFAULT_CELL_WIDTH - width) / 2 + x,
      y: row * DEFAULT_CELL_HEIGHT + (DEFAULT_CELL_HEIGHT - height) / 2 + y
    };
  }
  const hostBounds = attachedTo.di.bounds;
  return {
    width,
    height,
    x: Math.round(hostBounds.x + hostBounds.width / 2 - width / 2),
    y: Math.round(hostBounds.y + hostBounds.height - height / 2)
  };
}
function isDirectPathBlocked(source, target, layoutGrid) {
  const { row: sourceRow, col: sourceCol } = source.gridPosition;
  const { row: targetRow, col: targetCol } = target.gridPosition;
  const dX = targetCol - sourceCol;
  const dY = targetRow - sourceRow;
  let totalElements = 0;
  if (dX) {
    totalElements += layoutGrid.getElementsInRange({ row: sourceRow, col: sourceCol }, { row: sourceRow, col: targetCol }).length;
  }
  if (dY) {
    totalElements += layoutGrid.getElementsInRange({ row: sourceRow, col: targetCol }, { row: targetRow, col: targetCol }).length;
  }
  return totalElements > 2;
}
function directManhattanConnect(source, target, layoutGrid) {
  const { row: sourceRow, col: sourceCol } = source.gridPosition;
  const { row: targetRow, col: targetCol } = target.gridPosition;
  const dX = targetCol - sourceCol;
  const dY = targetRow - sourceRow;
  if (!(dX > 0 && dY !== 0)) {
    return;
  }
  if (dY > 0) {
    let totalElements = 0;
    const bendPoint = { row: targetRow, col: sourceCol };
    totalElements += layoutGrid.getElementsInRange({ row: sourceRow, col: sourceCol }, bendPoint).length;
    totalElements += layoutGrid.getElementsInRange(bendPoint, { row: targetRow, col: targetCol }).length;
    return totalElements > 2 ? false : ["v", "h"];
  } else {
    let totalElements = 0;
    const bendPoint = { row: sourceRow, col: targetCol };
    totalElements += layoutGrid.getElementsInRange({ row: sourceRow, col: sourceCol }, bendPoint).length;
    totalElements += layoutGrid.getElementsInRange(bendPoint, { row: targetRow, col: targetCol }).length;
    return totalElements > 2 ? false : ["h", "v"];
  }
}
function getMaxExpandedBetween(source, target, layoutGrid) {
  const hostSource = source.attachedToRef ? source.attachedToRef : source;
  const hostTarget = target.attachedToRef ? target.attachedToRef : target;
  const [sourceRow, sourceCol] = layoutGrid.find(hostSource);
  const [, targetCol] = layoutGrid.find(hostTarget);
  const firstCol = sourceCol < targetCol ? sourceCol : targetCol;
  const lastCol = sourceCol < targetCol ? targetCol : sourceCol;
  const elementsInRange = layoutGrid.getAllElements().filter((element) => element.gridPosition.row === sourceRow && element.gridPosition.col > firstCol && element.gridPosition.col < lastCol);
  return elementsInRange.reduce((acc, cur) => {
    if (cur.grid?.getGridDimensions()[0] > acc) return cur.grid?.getGridDimensions()[0];
  }, 0);
}
var Grid = class {
  constructor() {
    this.grid = [];
  }
  add(element, position) {
    if (!position) {
      this._addStart(element);
      return;
    }
    const [row, col] = position;
    if (!row && !col) {
      this._addStart(element);
    }
    if (!this.grid[row]) {
      this.grid[row] = [];
    }
    if (this.grid[row][col]) {
      throw new Error("Grid is occupied please ensure the place you insert at is not occupied");
    }
    this.grid[row][col] = element;
  }
  createRow(afterIndex) {
    if (!afterIndex && !Number.isInteger(afterIndex)) {
      this.grid.push([]);
    } else {
      this.grid.splice(afterIndex + 1, 0, []);
    }
  }
  _addStart(element) {
    this.grid.push([element]);
  }
  addAfter(element, newElement) {
    if (!element) {
      this._addStart(newElement);
    }
    const [row, col] = this.find(element);
    this.grid[row].splice(col + 1, 0, newElement);
  }
  addBelow(element, newElement) {
    if (!element) {
      this._addStart(newElement);
    }
    const [row, col] = this.find(element);
    if (!this.grid[row + 1]) {
      this.grid[row + 1] = [];
    }
    if (this.grid[row + 1][col]) {
      this.grid.splice(row + 1, 0, []);
    }
    if (this.grid[row + 1][col]) {
      throw new Error("Grid is occupied and we could not find a place - this should not happen");
    }
    this.grid[row + 1][col] = newElement;
  }
  find(element) {
    let row, col;
    row = this.grid.findIndex((row2) => {
      col = row2.findIndex((el) => {
        return el === element;
      });
      return col !== -1;
    });
    return [row, col];
  }
  get(row, col) {
    return (this.grid[row] || [])[col];
  }
  getElementsInRange({ row: startRow, col: startCol }, { row: endRow, col: endCol }) {
    const elements = [];
    if (startRow > endRow) {
      [startRow, endRow] = [endRow, startRow];
    }
    if (startCol > endCol) {
      [startCol, endCol] = [endCol, startCol];
    }
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        const element = this.get(row, col);
        if (element) {
          elements.push(element);
        }
      }
    }
    return elements;
  }
  adjustGridPosition(element) {
    let [row, col] = this.find(element);
    const [, maxCol] = this.getGridDimensions();
    if (col < maxCol - 1) {
      this.grid[row].length = maxCol;
      this.grid[row][maxCol] = element;
      this.grid[row][col] = null;
    }
  }
  adjustRowForMultipleIncoming(elements, currentElement) {
    const results = elements.map((element) => this.find(element));
    const lowestRow = Math.min(...results.map((result) => result[0]).filter((row2) => row2 >= 0));
    const [row, col] = this.find(currentElement);
    if (lowestRow < row && !this.grid[lowestRow][col]) {
      this.grid[lowestRow][col] = currentElement;
      this.grid[row][col] = null;
    }
  }
  adjustColumnForMultipleIncoming(elements, currentElement) {
    const results = elements.map((element) => this.find(element));
    const maxCol = Math.max(...results.map((result) => result[1]).filter((col2) => col2 >= 0));
    const [row, col] = this.find(currentElement);
    if (maxCol + 1 > col) {
      this.grid[row][maxCol + 1] = currentElement;
      this.grid[row][col] = null;
    }
  }
  getAllElements() {
    const elements = [];
    for (let row = 0; row < this.grid.length; row++) {
      for (let col = 0; col < this.grid[row].length; col++) {
        const element = this.get(row, col);
        if (element) {
          elements.push(element);
        }
      }
    }
    return elements;
  }
  getGridDimensions() {
    const numRows = this.grid.length;
    let maxCols = 0;
    for (let i = 0; i < numRows; i++) {
      const currentRowLength = this.grid[i].length;
      if (currentRowLength > maxCols) {
        maxCols = currentRowLength;
      }
    }
    return [numRows, maxCols];
  }
  elementsByPosition() {
    const elements = [];
    this.grid.forEach((row, rowIndex) => {
      row.forEach((element, colIndex) => {
        if (!element) {
          return;
        }
        elements.push({
          element,
          row: rowIndex,
          col: colIndex
        });
      });
    });
    return elements;
  }
  getElementsTotal() {
    const flattenedGrid = this.grid.flat();
    const uniqueElements = new Set(flattenedGrid.filter((value) => value));
    return uniqueElements.size;
  }
  /**
   *
   * @param {number} afterIndex - number is integer
   * @param {number=} colCount - number is positive integer
   */
  createCol(afterIndex, colCount) {
    this.grid.forEach((row, rowIndex) => {
      this.expandRow(rowIndex, afterIndex, colCount);
    });
  }
  /**
   * @param {number} rowIndex - is positive integer
   * @param {number} afterIndex - is integer
   * @param {number=} colCount - is positive integer
   */
  expandRow(rowIndex, afterIndex, colCount) {
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex > this.rowCount - 1) return;
    const placeholder = Number.isInteger(colCount) && colCount > 0 ? Array(colCount) : Array(1);
    const row = this.grid[rowIndex];
    if (!afterIndex && !Number.isInteger(afterIndex)) {
      row.splice(row.length, 0, ...placeholder);
    } else {
      row.splice(afterIndex + 1, 0, ...placeholder);
    }
  }
};
var DiFactory = class {
  constructor(moddle) {
    this.moddle = moddle;
  }
  create(type, attrs) {
    return this.moddle.create(type, attrs || {});
  }
  createDiBounds(bounds) {
    return this.create("dc:Bounds", bounds);
  }
  createDiLabel() {
    return this.create("bpmndi:BPMNLabel", {
      bounds: this.createDiBounds()
    });
  }
  createDiShape(semantic, bounds, attrs) {
    return this.create("bpmndi:BPMNShape", assign({
      bpmnElement: semantic,
      bounds: this.createDiBounds(bounds)
    }, attrs));
  }
  createDiWaypoints(waypoints) {
    var self = this;
    return map(waypoints, function(pos) {
      return self.createDiWaypoint(pos);
    });
  }
  createDiWaypoint(point) {
    return this.create("dc:Point", pick(point, ["x", "y"]));
  }
  createDiEdge(semantic, waypoints, attrs) {
    return this.create("bpmndi:BPMNEdge", assign({
      bpmnElement: semantic,
      waypoint: this.createDiWaypoints(waypoints)
    }, attrs));
  }
  createDiPlane(attrs) {
    return this.create("bpmndi:BPMNPlane", attrs);
  }
  createDiDiagram(attrs) {
    return this.create("bpmndi:BPMNDiagram", attrs);
  }
};
var attacherHandler = {
  "addToGrid": ({ element, grid, visited }) => {
    const nextElements = [];
    const attachedOutgoing = (element.attachers || []).map((attacher) => (attacher.outgoing || []).reverse()).flat().map((out) => out.targetRef);
    attachedOutgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }
      insertIntoGrid(nextElement, element, grid);
      nextElements.push(nextElement);
      visited.add(nextElement);
    });
    return nextElements;
  },
  "createElementDi": ({ element, row, col, diFactory, shift }) => {
    const hostBounds = getBounds(element, row, col, shift);
    const DIs = [];
    (element.attachers || []).forEach((att, i, arr) => {
      att.gridPosition = { row, col };
      const bounds = getBounds(att, row, col, shift, element);
      bounds.x = hostBounds.x + (i + 1) * (hostBounds.width / (arr.length + 1)) - bounds.width / 2;
      const attacherDi = diFactory.createDiShape(att, bounds, {
        id: att.id + "_di"
      });
      att.di = attacherDi;
      att.gridPosition = { row, col };
      DIs.push(attacherDi);
    });
    return DIs;
  },
  "createConnectionDi": ({ element, row, col, layoutGrid, diFactory, shift }) => {
    const attachers = element.attachers || [];
    return attachers.flatMap((att) => {
      const outgoing = att.outgoing || [];
      return outgoing.map((out) => {
        const target = out.targetRef;
        const waypoints = connectElements(att, target, layoutGrid);
        ensureExitBottom(att, waypoints, [row, col]);
        return diFactory.createDiEdge(out, waypoints, {
          id: out.id + "_di"
        });
      });
    });
  }
};
function insertIntoGrid(newElement, host, grid) {
  const [row, col] = grid.find(host);
  if (grid.get(row + 1, col) || grid.get(row + 1, col + 1)) {
    grid.createRow(row);
  }
  grid.add(newElement, [row + 1, col + 1]);
}
function ensureExitBottom(source, waypoints, [row, col]) {
  const sourceDi = source.di;
  const sourceBounds = sourceDi.get("bounds");
  const sourceMid = getMid(sourceBounds);
  const dockingPoint = getDockingPoint(sourceMid, sourceBounds, "b");
  if (waypoints[0].x === dockingPoint.x && waypoints[0].y === dockingPoint.y) {
    return;
  }
  const baseSourceGrid = source.grid || source.attachedToRef?.grid;
  if (waypoints.length === 2) {
    const newStart2 = [
      dockingPoint,
      { x: dockingPoint.x, y: !baseSourceGrid ? (row + 1) * DEFAULT_CELL_HEIGHT : (row + baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
      { x: !baseSourceGrid ? (col + 1) * DEFAULT_CELL_WIDTH : (col + baseSourceGrid.getGridDimensions()[1] + 1) * DEFAULT_CELL_WIDTH, y: !baseSourceGrid ? (row + 1) * DEFAULT_CELL_HEIGHT : (row + baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
      { x: !baseSourceGrid ? (col + 1) * DEFAULT_CELL_WIDTH : (col + baseSourceGrid.getGridDimensions()[1] + 1) * DEFAULT_CELL_WIDTH, y: !baseSourceGrid ? (row + 0.5) * DEFAULT_CELL_HEIGHT : row * DEFAULT_CELL_HEIGHT + DEFAULT_CELL_HEIGHT / 2 }
    ];
    waypoints.splice(0, 1, ...newStart2);
    return;
  }
  const newStart = [
    dockingPoint,
    { x: dockingPoint.x, y: !baseSourceGrid ? (row + 1) * DEFAULT_CELL_HEIGHT : (row + baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT },
    { x: waypoints[1].x, y: !baseSourceGrid ? (row + 1) * DEFAULT_CELL_HEIGHT : (row + baseSourceGrid.getGridDimensions()[0] + 1) * DEFAULT_CELL_HEIGHT }
  ];
  waypoints.splice(0, 1, ...newStart);
}
var elementHandler = {
  "createElementDi": ({ element, row, col, diFactory, shift }) => {
    const bounds = getBounds(element, row, col, shift);
    const options = {
      id: element.id + "_di"
    };
    if (is(element, "bpmn:ExclusiveGateway")) {
      options.isMarkerVisible = true;
    }
    if (element.isExpanded) {
      options.isExpanded = true;
    }
    const shapeDi = diFactory.createDiShape(element, bounds, options);
    element.di = shapeDi;
    element.gridPosition = { row, col };
    return shapeDi;
  }
};
var outgoingHandler = {
  "addToGrid": ({ element, grid, visited, stack }) => {
    let nextElements = [];
    const outgoing = (element.outgoing || []).map((out) => out.targetRef).filter((el) => el);
    let previousElement = null;
    if (outgoing.length > 1 && isNextElementTasks(outgoing)) {
      grid.adjustGridPosition(element);
    }
    outgoing.forEach((nextElement, index, arr) => {
      if (visited.has(nextElement)) {
        return;
      }
      if ((previousElement || stack.length > 0) && isFutureIncoming(nextElement, visited) && !checkForLoop(nextElement, visited)) {
        return;
      }
      if (!previousElement) {
        grid.addAfter(element, nextElement);
      } else if (is(element, "bpmn:ExclusiveGateway") && is(nextElement, "bpmn:ExclusiveGateway")) {
        grid.addAfter(previousElement, nextElement);
      } else {
        grid.addBelow(arr[index - 1], nextElement);
      }
      if (nextElement !== element) {
        previousElement = nextElement;
      }
      nextElements.unshift(nextElement);
      visited.add(nextElement);
    });
    nextElements = sortByType(nextElements, "bpmn:ExclusiveGateway");
    return nextElements;
  },
  "createConnectionDi": ({ element, row, col, layoutGrid, diFactory }) => {
    const outgoing = element.outgoing || [];
    return outgoing.map((out) => {
      const target = out.targetRef;
      const waypoints = connectElements(element, target, layoutGrid);
      const connectionDi = diFactory.createDiEdge(out, waypoints, {
        id: out.id + "_di"
      });
      return connectionDi;
    });
  }
};
function sortByType(arr, type) {
  const nonMatching = arr.filter((item) => !is(item, type));
  const matching = arr.filter((item) => is(item, type));
  return [...matching, ...nonMatching];
}
function checkForLoop(element, visited) {
  for (const incomingElement of element.incoming) {
    if (!visited.has(incomingElement.sourceRef)) {
      return findElementInTree(element, incomingElement.sourceRef);
    }
  }
}
function isFutureIncoming(element, visited) {
  if (element.incoming.length > 1) {
    for (const incomingElement of element.incoming) {
      if (!visited.has(incomingElement.sourceRef)) {
        return true;
      }
    }
  }
  return false;
}
function isNextElementTasks(elements) {
  return elements.every((element) => is(element, "bpmn:Task"));
}
var incomingHandler = {
  "addToGrid": ({ element, grid, visited }) => {
    const nextElements = [];
    const incoming = (element.incoming || []).map((out) => out.sourceRef).filter((el) => el);
    if (incoming.length > 1) {
      grid.adjustColumnForMultipleIncoming(incoming, element);
      grid.adjustRowForMultipleIncoming(incoming, element);
    }
    return nextElements;
  }
};
var handlers = [elementHandler, incomingHandler, outgoingHandler, attacherHandler];
var Layouter = class {
  constructor() {
    this.moddle = new SimpleBpmnModdle();
    this.diFactory = new DiFactory(this.moddle);
    this._handlers = handlers;
  }
  handle(operation, options) {
    return this._handlers.filter((handler) => isFunction(handler[operation])).map((handler) => handler[operation](options));
  }
  async layoutProcess(xml2) {
    const moddleObj = await this.moddle.fromXML(xml2);
    const { rootElement } = moddleObj;
    this.diagram = rootElement;
    const firstRootProcess = this.getProcess();
    if (firstRootProcess) {
      this.setExpandedPropertyToModdleElements(moddleObj);
      this.setExecutedProcesses(firstRootProcess);
      this.createGridsForProcesses();
      this.cleanDi();
      this.createRootDi(firstRootProcess);
      this.drawProcesses();
    }
    return (await this.moddle.toXML(this.diagram, { format: true })).xml;
  }
  createGridsForProcesses() {
    const processes = this.layoutedProcesses.sort((a, b) => b.level - a.level);
    for (const process of processes) {
      process.grid = this.createGridLayout(process);
      expandGridHorizontally(process.grid);
      expandGridVertically(process.grid);
      if (process.isExpanded) {
        const [rowCount, colCount] = process.grid.getGridDimensions();
        if (rowCount === 0) process.grid.createRow();
        if (colCount === 0) process.grid.createCol();
      }
    }
  }
  setExpandedPropertyToModdleElements(bpmnModel) {
    const allElements = bpmnModel.elementsById;
    if (allElements) {
      for (const element of Object.values(allElements)) {
        if (element.$type === "bpmndi:BPMNShape" && element.isExpanded === true) element.bpmnElement.isExpanded = true;
      }
    }
  }
  setExecutedProcesses(firstRootProcess) {
    this.layoutedProcesses = [];
    const executionStack = [firstRootProcess];
    while (executionStack.length > 0) {
      const executedProcess = executionStack.pop();
      this.layoutedProcesses.push(executedProcess);
      executedProcess.level = executedProcess.$parent === this.diagram ? 0 : executedProcess.$parent.level + 1;
      const nextProcesses = executedProcess.get("flowElements").filter((flowElement) => is(flowElement, "bpmn:SubProcess"));
      executionStack.splice(executionStack.length, 0, ...nextProcesses);
    }
  }
  cleanDi() {
    this.diagram.diagrams = [];
  }
  createGridLayout(root) {
    const grid = new Grid();
    const flowElements = root.flowElements || [];
    const elements = flowElements.filter((el) => !is(el, "bpmn:SequenceFlow"));
    if (!flowElements) {
      return grid;
    }
    bindBoundaryEventsWithHosts(flowElements);
    const visited = /* @__PURE__ */ new Set();
    while (visited.size < elements.filter((element) => !element.attachedToRef).length) {
      const startingElements = flowElements.filter((el) => {
        return !isConnection(el) && !isBoundaryEvent(el) && (!el.incoming || !hasOtherIncoming(el)) && !visited.has(el);
      });
      const stack = [...startingElements];
      startingElements.forEach((el) => {
        grid.add(el);
        visited.add(el);
      });
      this.handleGrid(grid, visited, stack);
      if (grid.getElementsTotal() !== elements.length) {
        const gridElements = grid.getAllElements();
        const missingElements = elements.filter((el) => !gridElements.includes(el) && !isBoundaryEvent(el));
        if (missingElements.length > 0) {
          stack.push(missingElements[0]);
          grid.add(missingElements[0]);
          visited.add(missingElements[0]);
          this.handleGrid(grid, visited, stack);
        }
      }
    }
    return grid;
  }
  generateDi(layoutGrid, shift, procDi) {
    const diFactory = this.diFactory;
    const prePlaneElement = procDi ? procDi : this.diagram.diagrams[0];
    const planeElement = prePlaneElement.plane.get("planeElement");
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this.handle("createElementDi", { element, row, col, layoutGrid, diFactory, shift }).flat();
      planeElement.push(...dis);
    });
    layoutGrid.elementsByPosition().forEach(({ element, row, col }) => {
      const dis = this.handle("createConnectionDi", { element, row, col, layoutGrid, diFactory, shift }).flat();
      planeElement.push(...dis);
    });
  }
  handleGrid(grid, visited, stack) {
    while (stack.length > 0) {
      const currentElement = stack.pop();
      const nextElements = this.handle("addToGrid", { element: currentElement, grid, visited, stack });
      nextElements.flat().forEach((el) => {
        stack.push(el);
        visited.add(el);
      });
    }
  }
  getProcess() {
    return this.diagram.get("rootElements").find((el) => el.$type === "bpmn:Process");
  }
  createRootDi(processes) {
    this.createProcessDi(processes);
  }
  createProcessDi(element) {
    const diFactory = this.diFactory;
    const planeDi = diFactory.createDiPlane({
      id: "BPMNPlane_" + element.id,
      bpmnElement: element
    });
    const diagramDi = diFactory.createDiDiagram({
      id: "BPMNDiagram_" + element.id,
      plane: planeDi
    });
    const diagram = this.diagram;
    diagram.diagrams.push(diagramDi);
    return diagramDi;
  }
  /**
   * Draw processes.
   * Root processes should be processed first for element expanding
   */
  drawProcesses() {
    const sortedProcesses = this.layoutedProcesses.sort((a, b) => a.level - b.level);
    for (const process of sortedProcesses) {
      if (process.isExpanded) {
        const baseProcDi = this.getElementDi(process);
        const diagram2 = this.getProcDi(baseProcDi);
        let { x, y } = baseProcDi.bounds;
        const { width, height } = getDefaultSize(process);
        x += DEFAULT_CELL_WIDTH / 2 - width / 4;
        y += DEFAULT_CELL_HEIGHT - height - height / 4;
        this.generateDi(process.grid, { x, y }, diagram2);
        continue;
      }
      const diagram = this.diagram.diagrams.find((diagram2) => diagram2.plane.bpmnElement === process);
      this.generateDi(process.grid, { x: 0, y: 0 }, diagram);
    }
  }
  getElementDi(element) {
    return this.diagram.diagrams.map((diagram) => diagram.plane.planeElement).flat().find((item) => item.bpmnElement === element);
  }
  getProcDi(element) {
    return this.diagram.diagrams.find((diagram) => diagram.plane.planeElement.includes(element));
  }
};
function bindBoundaryEventsWithHosts(elements) {
  const boundaryEvents = elements.filter((element) => isBoundaryEvent(element));
  boundaryEvents.forEach((boundaryEvent) => {
    const attachedTask = boundaryEvent.attachedToRef;
    const attachers = attachedTask.attachers || [];
    attachers.push(boundaryEvent);
    attachedTask.attachers = attachers;
  });
}
function expandGridHorizontally(grid) {
  const [numRows, maxCols] = grid.getGridDimensions();
  for (let i = maxCols - 1; i >= 0; i--) {
    const elementsInCol = [];
    for (let j = 0; j < numRows; j++) {
      const candidate = grid.get(j, i);
      if (candidate && candidate.isExpanded) elementsInCol.push(candidate);
    }
    if (elementsInCol.length === 0) continue;
    const maxColCount = elementsInCol.reduce((acc, cur) => {
      const [, curCols] = cur.grid.getGridDimensions();
      if (acc === void 0 || curCols > acc) return curCols;
      return acc;
    }, void 0);
    const shift = !maxColCount ? 2 : maxColCount;
    grid.createCol(i, shift);
  }
}
function expandGridVertically(grid) {
  const [numRows, maxCols] = grid.getGridDimensions();
  for (let i = numRows - 1; i >= 0; i--) {
    const elementsInRow = [];
    for (let j = 0; j < maxCols; j++) {
      const candidate = grid.get(i, j);
      if (candidate && candidate.isExpanded) elementsInRow.push(candidate);
    }
    if (elementsInRow.length === 0) continue;
    const maxRowCount = elementsInRow.reduce((acc, cur) => {
      const [curRows] = cur.grid.getGridDimensions();
      if (acc === void 0 || curRows > acc) return curRows;
      return acc;
    }, void 0);
    const shift = !maxRowCount ? 1 : maxRowCount;
    for (let index = 0; index < shift; index++) {
      grid.createRow(i);
    }
  }
}
function hasOtherIncoming(element) {
  const fromHost = element.incoming?.filter((edge) => edge.sourceRef !== element && edge.sourceRef.attachedToRef === void 0) || [];
  const fromAttached = element.incoming?.filter((edge) => edge.sourceRef !== element && edge.sourceRef.attachedToRef !== element);
  return fromHost?.length > 0 || fromAttached?.length > 0;
}
function layoutProcess(xml2) {
  return new Layouter().layoutProcess(xml2);
}
export {
  SimpleBpmnModdle as BpmnModdle,
  layoutProcess
};
