var Widgets = Debugger.Widgets = {};

/**
 * Base class for Debugger Widget.
 */

Widgets.Widget = function (attributes, options) {
    var self = this;

    this.attributes = _.defaults({}, attributes || {}, _.result(this, 'defaults'));

    // check if an *id* and a *kind* is given
    _.forEach(['id', 'kind'], function (key) {
        _.has(self.attributes, key) || throwError('You must specify some *#{key}* to create a Widget.', { key: key});
    });

    _.bindAll(this);

    this.exprs = {};
    this.buffer = new Debugger.SmartBuffer(this.attributes.buffer);
    this.gid = this.attributes.kind + "-" + sluggify(this.attributes.id);

    if (_.isFunction(this.initialize)) {
        this.initialize(options);
    }
};

Widgets.Widget.extend = Debugger.extend;

//
// Widget methods
//

_.extend(Widgets.Widget.prototype, Backbone.Events, {
    initialize: function (options) {
        var self = this;

        options || (options = {});

        // set default options in case some is omitted
        this.options = _.defaults(options, {
            width: 960,
            height: 100,
            margin: {
                top: 0,
                right: 0,
                bottom: 0,
                left: 0
            },
            placeholder: {
                sidebar: {
                    width: 100
                }
            },
            ruler: {
                width: 30
            }
        });

        // compute expressions
        this.compute('svg.width', 'this.options.width - this.options.placeholder.sidebar.width - this.options.margin.left - this.options.margin.right');
        this.compute('svg.height', 'this.options.height - this.options.margin.top - this.options.margin.bottom');

        // init ui
        this._init_ui();
    },

    _init_ui: function () {
        var args = Array.prototype.slice.call(arguments);

        // notify that we are going to initialize UI
        this.triggerMethod.apply(this, ['before:init:UI'].concat(args));

        // main element
        this.$el = $('<div/>')
            .attr({
                id: this.gid
            })
            .addClass('element')
            .css({
                'margin-top': this.options.margin.top,
                'margin-left': this.options.margin.left,
                'margin-bottom': this.options.margin.bottom,
                'margin-right': this.options.margin.right
            })
            .append('<div class="placeholder sidebar"></div>')
            .append('<div class="placeholder d3"></div>')
            .append('<div class="placeholder aside"></div>');

        this.el = this.$el[0];

        // side bar located at the left of d3 placeholder
        this._$sidebar = this.$('.placeholder.sidebar').css({
            'width': this.options.placeholder.sidebar.width,
            'height': this.computed('svg.height')
        });
        // d3 placeholder (where we draw)
        this._$d3 = this.$('.placeholder.d3').css({
            'width': this.computed('svg.width'),
            'height': this.computed('svg.height')
        }).append(BASE_SVG);
        // placeholder located/floating around the ruler
        this._$aside = this.$('.placeholder.aside').css({
            'height': this.computed('svg.height')
        });

        // notify that we are initializing UI
        this.triggerMethod.apply(this, ['init:UI'].concat(args));
    },

    // jQuery delegate for element lookup, scoped to DOM elements within the
    // current view. This should be preferred to global lookups where possible.
    $: function (selector) {
        return this.$el.find(selector);
    },

    /**
     * Handler for attached event.
     * @param to
     */
    onAttached: function (to) {
        var args = Array.prototype.slice.call(arguments);

        // set ourselves as attached
        this.isAttached = true;

        // notify that we are going to initialized d3
        this.triggerMethod.apply(this, ['before:init:d3'].concat(args));

        // d3 SVG object
        this.svg = d3.select(this._$d3[0]).select("svg").attr({
            'width': this.computed('svg.width'),
            'height': this.computed('svg.height')
        }).append("g");

        // setup d3 functions
        this.dateFn = function (timestamp) {
            return new Date(parseInt(timestamp))
        };

        // setup d3 timescale
        this.timescale = d3.time.scale()
            .range([0, this.computed('svg.width')]);

        // notify that we are initializing d3
        this.triggerMethod.apply(this, ['init:d3'].concat(args));
    },

    /**
     * Return the value of a computed property.
     *
     * @param property
     * @returns {*}
     */
    computed: function (property) {
        return this.exprs[property].value;
    },

    /**
     * Compute the value of a `property' given some expression.
     *
     * @warning the value is not automatically recomputed.
     *
     * @param property
     * @param expression
     * @returns {*}
     */
    compute: function (property, expression) {
        this.exprs[property] = {
            expression: expression,
            value: eval(expression)
        };

        return this.exprs[property].value;
    },

    update: function (data, domain, options) {
        // set default options
        options = _.defaults({}, options, {
            render: true
        });

        // build up args for callback
        var args = Array.prototype.slice.call([data, domain, options]);

        // trigger onBeforeFrameUpdate
        this.triggerMethod.apply(this, ['before:frame:update'].concat(args));

        // collect new data
        if (data && data.bulk) {
            this.buffer.concat(data.bulk)
        } else if (data && data.timestamp) {
            this.buffer.push(data.timestamp, data.frame);
        }

        // render only if required
        if (options && options.render) {
            // update d3
            this.timescale.domain(d3.extent(domain, this.dateFn));

            // trigger onFrameUpdate
            this.triggerMethod.apply(this, ['frame:update'].concat(args));
        }
    },

    rulerFocusChanged: function (position) {
        var timestamp = this.timescale.invert(parseInt(position)).getTime();
        var frame = this.buffer.at(timestamp);

        // trigger onBeforeRulerFocusUpdate
        this.triggerMethod.apply(this, ['before:ruler:focus:update', position, timestamp, frame]);

        // hide widget if it does not have any state (meaning it disappeared)
        if (missing(frame, 'data.event.state')) {
            this.$el.css('opacity', 0.1);
        } else {
            this.$el.css('opacity', 1);
        }

        // trigger onRulerFocusUpdate
        this.triggerMethod.apply(this, ['ruler:focus:update', position, timestamp, frame]);
    },

    /**
     * Handler for detached event.
     *
     * @param from
     */
    onDetached: function (from) {
        var args = Array.prototype.slice.call(arguments);

        this.triggerMethod.apply(this, ['before:destroy:d3'].concat(args));

        this.svg.selectAll('*').remove();
        this.svg.remove();
        this.svg = null;

        this.triggerMethod.apply(this, ['destroy:d3'].concat(args));
    },

    // import the `triggerMethod` to trigger events with corresponding
    // methods if the method exists
    triggerMethod: Debugger.triggerMethod
});

//
// Widgets mixins.
//
Widgets.Mixins = {
    Chart: {
        initD3Chart: function () {
            this.chart = this.svg.insert('g', '.markers').attr({class: 'area'}).selectAll('rect');
            this.chart_border = this.svg.insert('path', '.markers').attr({class: 'border'});
            this.chart_extra = this.svg.insert('line', /* insert before */ '.markers').attr({class: 'border pending'});
        },
        updateD3Chart: function () {
            var self = this;

            // chart
            var chart = this.chart = this.chart.data(
                this.buffer.select(function (d) {
                    return ensure(d, 'data.event.type', 'update');
                }),
                function (d) {
                    return d.timestamp
                }
            );

            chart.enter().append('rect').attr({
                x: function (d) {
                    return self.timescale(self.dateFn(d.timestamp));
                },
                y: function (d) {
                    return self.computed('svg.height') - self.y(self.valueFn(d.data));
                },
                width: function (d) {
                    return self.timescale(self.dateFn(d.next.timestamp)) - self.timescale(self.dateFn(d.timestamp))
                },
                height: function (d) {
                    return self.y(self.valueFn(d.data))
                }
            });
            chart.attr({
                x: function (d) {
                    return self.timescale(self.dateFn(d.timestamp))
                },
                y: function (d) {
                    return self.computed('svg.height') - self.y(self.valueFn(d.data))
                },
                width: function (d) {
                    return self.timescale(self.dateFn(d.next.timestamp)) - self.timescale(self.dateFn(d.timestamp))
                },
                height: function (d) {
                    return self.y(self.valueFn(d.data))
                }
            });
            chart.exit().remove();

            // border
            var line = d3.svg.line()
                .x(function (d) {
                    return self.timescale(self.dateFn(d.timestamp));
                })
                .y(function (d) {
                    if (ensure(d, 'data.event.type', 'update')) {
                        return self.computed('svg.height') - self.y(self.valueFn(d.data));
                    } else {
                        return self.computed('svg.height') + 1;
                    }
                })
                .interpolate("step-after");
            this.chart_border.datum(
                this.buffer.all(),
                function (d) {
                    return d.timestamp
                })
                .attr("d", line);

            // extra border
            var last = this.buffer.last();
            this.chart_extra.attr({
                x1: self.timescale(self.dateFn(last.timestamp)),
                y1: function () {
                    if (ensure(last, 'data.event.type', 'update')) {
                        return self.computed('svg.height') - self.y(self.valueFn(last.data));
                    } else {
                        return self.computed('svg.height') + 1;
                    }
                },
                x2: self.timescale(self.dateFn(last.next.timestamp)),
                y2: function () {
                    if (ensure(last, 'data.event.type', 'update')) {
                        return self.computed('svg.height') - self.y(self.valueFn(last.data));
                    } else {
                        return self.computed('svg.height') + 1;
                    }
                }
            });
        }
    },
    Markers: {
        initD3Markers: function() {
            this.markers = this.svg.append('g').attr({class: 'markers'}).selectAll('.marker');
        },

        updateD3Markers: function () {
            var self = this;

            //
            // markers
            //
            var markers = this.markers = this.markers.data(
                this.buffer.reject(function (d) {
                    return _.isEmpty(d.data.decorations);
                }),
                function (d) {
                    return d.timestamp
                }
            );

            markers.enter().append("g")
                .attr({
                    class: "marker"
                })
                .append("use")
                .attr({
                    'xlink:href': function (d) {
                        if (d.data.decorations.length > 1) {
                            return "#magnify"
                        } else {
                            return "#" + d.data.decorations[0].type;
                        }
                    },
                    'class': "decoration",
                    //@todo scale(1.5)
                    'transform': 'scale(1.5) translate(' + (-5 * 1.5) + ',' + (self.computed('svg.height') / 1.5 - (10 * 1.5)) + ')',
                })
                .on("click", function (d) {
                    alert(d.data.decorations[0].description);
                });
            markers.attr({
                transform: function (d) {
                    return "translate(" + self.timescale(self.dateFn(d.timestamp)) + ", 0)";
                }
            });
            markers.exit().remove()
        }
    }
};

//
// Specific widgets
//

// @include widgets/debugger.focusline.js
// @include widgets/debugger.timeline.js
// @include widgets/debugger.devices.js
// @include widgets/debugger.programs.js