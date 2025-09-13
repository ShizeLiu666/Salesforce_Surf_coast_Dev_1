import { LightningElement, api, track } from 'lwc';
// Lightweight log prefix + version to make console filtering easy
const LOG_TAG = '[PublicCalendar]';
const LOG_VERSION = 'v2025.08.22-1';
import getPublicCalendarEvents from '@salesforce/apex/PublicCalendarController.getPublicCalendarEvents';
import getPublicCalendars from '@salesforce/apex/PublicCalendarController.getPublicCalendars';

export default class PublicCalendarView extends LightningElement {
    @api calendarId;
    @api defaultView = 'week';
    @api headerToolbar;
    @api weekNumbers;
    @api eventLimit = 3;

    @track events = [];
    @track loading = true;
    @track error = false;
    @track errorMessage = '';
    @track calendars = [];
    @track selectedCalendarId = '';
    @track currentWeekStart;
    @track currentMonth = new Date().getMonth();
    @track currentYear = new Date().getFullYear();
    @track weekDays = [];
    @track monthDays = [];
    @track viewMode = 'week'; // 'week' or 'month'
    @track showViewDropdown = false;
    @track timeSlots = [];
    @track gridCells = []; // 7×24 cell descriptors with IDs
    @track showEventModal = false;
    @track selectedEvent = {};

    // ========== CACHE OPTIMIZATION - START ==========
    @track cachedEvents = [];
    @track cacheTimestamp = null;
    @track cacheCalendarId = null;
    @track isCurrentlyFetching = false;
    // ========== CACHE OPTIMIZATION - END ==========

    // ========== DEBUG AND MONITORING - START ==========
    @track debugMode = false;
    @track performanceStats = {
        lastLayoutTime: 0,
        totalEvents: 0,
        totalClusters: 0,
        averageClusterSize: 0,
        dynamicEventsCount: 0
    };
    // ========== DEBUG AND MONITORING - END ==========

    SLOT_HEIGHT_PX = 50; // px per hour (must match CSS .time-slot height)

    dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    dayNamesShort = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    monthNames = ['January', 'February', 'March', 'April', 'May',
                  'June', 'July', 'August', 'September', 'October', 'November', 'December'];

    viewOptions = [
        { label: 'Week', value: 'week', icon: 'utility:date_input' },
        { label: 'Month', value: 'month', icon: 'utility:monthlyview' }
    ];

    connectedCallback() {
        // console.log('[Init] PublicCalendarView connected');
        // console.log(`${LOG_TAG} ${LOG_VERSION} - component connected`);
        this.initializeCurrentWeekStart();
        this.buildTimeSlots();
        this.loadCalendarData();
        
        // 设置全局调试工具
        this.setupGlobalDebugTools();
    }

    renderedCallback() {
        
        // Always ensure scroll functionality works
        this.ensureScrollFunctionality();
        
        // Apply grid positioning to events
        this.applyGridPositioning();
    }
    
    ensureScrollFunctionality() {
        const days = this.template.querySelector('.week-days-grid');
        const gutter = this.template.querySelector('.week-time-column');
        
        if (days && gutter) {
            
            // Remove existing listener if any
            if (this._syncScroll) {
                days.removeEventListener('scroll', this._syncScroll);
            }
            
            // Create new scroll sync function
            this._syncScroll = () => { 
                gutter.scrollTop = days.scrollTop; 
            };
            
            // Add scroll listener
            days.addEventListener('scroll', this._syncScroll);
            this._scrollSynced = true;
            
            // Make scroll methods available in console for debugging
            window.calendarScrollTo = (position) => {
                days.scrollTop = position;
                gutter.scrollTop = position;
            };
            
            window.calendarScrollToBottom = () => {
                const maxScroll = days.scrollHeight - days.clientHeight;
                days.scrollTop = maxScroll;
                gutter.scrollTop = maxScroll;
            };
            
            // Auto-scroll to 4 AM only on initial load
            if (!this._hasAutoScrolled) {
                this.scrollTo4AM();
                this._hasAutoScrolled = true;
            }
        } else {
        }
    }

    applyGridPositioning() {
        // Apply optimized positioning styles to events
        const eventElements = this.template.querySelectorAll('.grid-positioned');
        
        console.log(`[OptimizedGrid] 应用新布局，共 ${eventElements.length} 个事件元素`);
        
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#06b6d4'];
        
        eventElements.forEach(eventElement => {
            const eventId = eventElement.dataset.eventId;
            // Find the event data
            let eventData = null;
            for (const day of this.weekDays) {
                for (const event of day.allEvents) {
                    if (event._key === eventId) {
                        eventData = event;
                        break;
                    }
                }
                if (eventData) break;
            }
            
            if (eventData) {
                // 检查是否使用了新的优化算法
                if (eventData._isOptimized) {
                    console.log(`[OptimizedGrid] 应用优化布局: "${eventData.title}"`);
                    
                    // 使用新算法计算的几何信息
                    eventElement.style.position = 'absolute';
                    eventElement.style.top = `${eventData._top || 0}px`;
                    eventElement.style.height = `${eventData._height || 30}px`;
                    eventElement.style.width = eventData._width || '100%';
                    eventElement.style.left = eventData._left || '0%';
                    eventElement.style.zIndex = '10';
                    
                    // 应用颜色（基于列索引）
                    const colorIndex = eventData._colIndex !== undefined ? 
                        eventData._colIndex % colors.length : 0;
                    const color = colors[colorIndex];
                    eventElement.style.setProperty('background-color', color, 'important');
                    
                    // 动态布局标识
                    if (eventData._isDynamic) {
                        eventElement.classList.add('dynamic-layout');
                        eventElement.setAttribute('title', 
                            `${eventData.title} (动态布局, ${eventData._segmentCount || 1} 个时间段)`
                        );
                    }
                    
                    // 调试日志
                    if (eventData.title && eventData.title.includes('Kate')) {
                        console.log(`[OptimizedGrid] "${eventData.title}":`, {
                            top: eventData._top,
                            height: eventData._height,
                            width: eventData._width,
                            left: eventData._left,
                            colIndex: eventData._colIndex,
                            totalColumns: eventData._totalColumns,
                            isDynamic: eventData._isDynamic,
                            clusterIndex: eventData._clusterIndex
                        });
                    }
                    
                } else {
                    // 回退到旧算法（兼容性）
                    console.log(`[OptimizedGrid] 回退旧算法: "${eventData.title}"`);
                    
                    eventElement.style.position = 'absolute';
                    eventElement.style.top = `${eventData._topPosition || 0}px`;
                    eventElement.style.height = `${eventData._height || 30}px`;
                    eventElement.style.zIndex = '10';
                    
                    if (eventData._totalInGroup !== undefined && eventData._totalInGroup > 1) {
                        const containerWidth = eventElement.parentElement.clientWidth;
                        const eventWidth = Math.floor(containerWidth / eventData._totalInGroup);
                        const columnIndex = eventData._columnIndex !== undefined ? 
                            eventData._columnIndex : eventData._eventIndex || 0;
                        const leftPosition = columnIndex * eventWidth;
                        
                        eventElement.style.left = `${leftPosition}px`;
                        eventElement.style.width = `${eventWidth}px`;
                        
                        if (eventData._colorIndex !== undefined) {
                            const color = colors[eventData._colorIndex % colors.length];
                            eventElement.style.setProperty('background-color', color, 'important');
                        }
                    } else {
                        eventElement.style.left = '0px';
                        eventElement.style.right = '0px';
                        eventElement.style.width = 'auto';
                        
                        const color = colors[0];
                        eventElement.style.setProperty('background-color', color, 'important');
                    }
                }
                
                // 重复事件样式
                if (eventData.isRecurring) {
                    eventElement.classList.add('recurring-event');
                }
                
            } else {
                console.warn(`[OptimizedGrid] 未找到事件数据: ${eventId}`);
            }
        });
        
        console.log(`[OptimizedGrid] 布局应用完成`);
    }

    scrollTo4AM() {
        // Our time slots go: 5 AM (index 0), 6 AM (index 1), ..., 3 AM (index 22), 4 AM (index 23)
        // So 4 AM is at index 23 in our time slots array
        const scrollPosition = 23 * this.SLOT_HEIGHT_PX;
        
        setTimeout(() => {
            const days = this.template.querySelector('.week-days-grid');
            const gutter = this.template.querySelector('.week-time-column');
            if (days && gutter) {
                
                days.scrollTop = scrollPosition;
                gutter.scrollTop = scrollPosition;
                
                // Verify scroll position was set
                setTimeout(() => {
                }, 50);
            }
        }, 200); // Increased delay to ensure DOM is fully ready
    }

    disconnectedCallback() {
        if (this._boundOutside) {
            this.template.removeEventListener('click', this._boundOutside);
        }
        const days = this.template.querySelector('.week-days-grid');
        if (this._scrollSynced && days && this._syncScroll) {
            days.removeEventListener('scroll', this._syncScroll);
            this._scrollSynced = false;
        }
        
        // ========== CACHE CLEANUP - START ==========
        // Clean up cache when component unmounts to free memory
        this.clearCache();
        // ========== CACHE CLEANUP - END ==========
    }

    // ---------- setup ----------
    buildTimeSlots() {
        const slots = [];
        // Start at 5 AM (hour 5) and go through to 4 AM next day (hour 28, wrapping at 24)
        for (let h = 5; h < 29; h++) {
            const actualHour = h % 24; // Wrap around after 24
            const hour12 = ((actualHour + 11) % 12) + 1;
            const ampm = actualHour < 12 ? 'AM' : 'PM';
            slots.push({ value: actualHour, label: `${hour12} ${ampm}` });
        }
        this.timeSlots = slots;
    }

    initializeCurrentWeek() {
        const today = new Date();
        const daysFromSunday = today.getDay(); // 0=Sun
        this.currentWeekStart = new Date(today);
        this.currentWeekStart.setDate(today.getDate() - daysFromSunday);
        this.currentWeekStart.setHours(0, 0, 0, 0);
    }

    // Alias method for consistency 
    initializeCurrentWeekStart() {
        this.initializeCurrentWeek();
    }

    // ========== CACHE OPTIMIZATION METHODS - START ==========
    
    // Check if cache is valid
    isCacheValid() {
        const CACHE_DURATION = 5 * 60 * 1000; // 5-minute cache
        return this.cacheTimestamp && 
               this.cacheCalendarId === this.selectedCalendarId &&
               (Date.now() - this.cacheTimestamp) < CACHE_DURATION &&
               this.cachedEvents.length > 0;
    }
    
    // Update cache
    updateCache(events) {
        this.cachedEvents = [...events];
        this.cacheTimestamp = Date.now();
        this.cacheCalendarId = this.selectedCalendarId;
    }
    
    // Clear cache
    clearCache() {
        this.cachedEvents = [];
        this.cacheTimestamp = null;
        this.cacheCalendarId = null;
    }
    
    // Log cache statistics
    logCacheStats() {
        const cacheAge = this.cacheTimestamp ? (Date.now() - this.cacheTimestamp) / 1000 : 0;
    }
    
    // ========== CACHE OPTIMIZATION METHODS - END ==========

    // ---------- data ----------
    async loadCalendarData() {
        try {
            if (this.calendarId) {
                this.selectedCalendarId = this.calendarId;
            } else {
                const calendarMap = await getPublicCalendars();
                if (calendarMap && Object.keys(calendarMap).length > 0) {
                    this.calendars = Object.entries(calendarMap).map(([id, name]) => ({ value: id, label: name }));
                    this.selectedCalendarId = this.calendars[0].value;
                    this.calendarId = this.selectedCalendarId;
                } else {
                    this.loading = false;
                    this.error = true;
                    this.errorMessage = 'No calendars available.';
                    return;
                }
            }
            if (this.selectedCalendarId) {
                await this.fetchEvents();
            }
        } catch (error) {
            this.handleError(error);
        }
    }

    async fetchEvents() {
        try {
            // ========== CACHE CHECK - START ==========
            this.logCacheStats();
            
            // Check if cache is valid
            if (this.isCacheValid()) {
                this.events = [...this.cachedEvents];
                this.refreshView();
                this.loading = false;
                return;
            }
            
            // Avoid concurrent requests
            if (this.isCurrentlyFetching) {
                return;
            }
            
            this.isCurrentlyFetching = true;
            // ========== CACHE CHECK - END ==========
            
            this.loading = true;
            this.error = false;

            const data = await getPublicCalendarEvents({ calendarId: this.selectedCalendarId });
            const raw = Array.isArray(data) ? data : [];
            
            // console.log(`[Fetch] Raw data from Apex: ${raw.length} events`);
            const owners = [...new Set(raw.map(e => e.ownerId).filter(Boolean))];
            // console.log('[Fetch] Owners in payload:', owners);
            // if (owners.length && this.selectedCalendarId && !owners.includes(this.selectedCalendarId)) {
            //     console.warn('[Fetch] ⚠️ Owner mismatch: selectedCalendarId not present in returned events. Check sharing and SOQL owner filter.');
            // }
            // console.log('🔬 EXPERT DEV ANALYSIS - Raw data structure:');
            // console.log('First 3 events with ALL properties:', JSON.stringify(raw.slice(0, 3), null, 2));
            
            // NEW: Count events by type to see what we're getting
            let recurringMasters = 0;
            let singleEvents = 0;
            let recurringInstances = 0;
            
            raw.forEach(event => {
                if (event.isRecurringEnhanced || event.isRecurringClassic) {
                    if (!event.recurrenceActivityId) {
                        recurringMasters++;
                    } else {
                        recurringInstances++;
                    }
                } else {
                    singleEvents++;
                }
            });
            
            // console.log('🧮 EVENT TYPE BREAKDOWN:');
            // console.log(`- Recurring Masters: ${recurringMasters}`);
            // console.log(`- Recurring Instances: ${recurringInstances}`);
            // console.log(`- Single Events: ${singleEvents}`);
            // console.log(`- Total: ${raw.length}`);
            
            // Let's check if ANY events have recurring patterns
            const eventsWithPatterns = raw.filter(e => e.recurrencePatternText && e.recurrencePatternText.trim().length > 0);
            // console.log(`🎯 Events with recurrence patterns found: ${eventsWithPatterns.length}`);
            // console.log('Events with patterns:', eventsWithPatterns.map(e => ({
            //     title: e.title,
            //     pattern: e.recurrencePatternText,
            //     isRecurring: e.isRecurring,
            //     isRecurringEnhanced: e.isRecurringEnhanced
            // })));
            
            // console.log('[Fetch] Raw events field analysis:', raw.slice(0, 5).map(e => ({
            //     id: e.id,
            //     title: e.title,
            //     startDateTime: e.startDateTime,
            //     // Check all possible recurring field names
            //     isRecurring: e.isRecurring,
            //     isRecurringEnhanced: e.isRecurringEnhanced,
            //     isRecurringClassic: e.isRecurringClassic,
            //     recurrencePatternText: e.recurrencePatternText,
            //     // Check if there are other field names
            //     allKeys: Object.keys(e)
            // })));
            
            // Process events and expand recurring ones
            this.events = [];
            let recurringEventCount = 0;
            let singleEventCount = 0;
            let totalInstancesGenerated = 0;
            let eventIndex = 0; // Track event index for testing
            
            for (const e of raw) {
                const normalizedEvent = this.normalizeEvent(e);
                
                // console.log(`[Fetch] Processing event: "${normalizedEvent.title}" | isRecurring: ${normalizedEvent.isRecurring}`);
                // console.log(`[Fetch] Event details for "${normalizedEvent.title}":`, {
                //     isRecurring: normalizedEvent.isRecurring,
                //     isRecurringEnhanced: normalizedEvent.isRecurringEnhanced,
                //     isRecurringClassic: normalizedEvent.isRecurringClassic,
                //     recurrencePatternText: normalizedEvent.recurrencePatternText,
                //     hasPattern: !!normalizedEvent.recurrencePatternText
                // });
                
                // EXPERT DEV APPROACH: Multiple fallback strategies
                const hasRecurrencePattern = normalizedEvent.recurrencePatternText && normalizedEvent.recurrencePatternText.trim().length > 0;
                const isInstanceRow = !!normalizedEvent.recurrenceActivityId; // actual generated instance from Salesforce
                // Expand only masters (flags true) without RecurrenceActivityId, or when explicit pattern exists
                const shouldExpand = !isInstanceRow && (normalizedEvent.isRecurring || hasRecurrencePattern);
                
                // console.log(`[Fetch] 🧠 EXPERT DEV ANALYSIS for "${normalizedEvent.title}":`, {
                //     hasRecurrencePattern: hasRecurrencePattern,
                //     patternValue: normalizedEvent.recurrencePatternText,
                //     shouldExpand: shouldExpand,
                //     originalIsRecurring: normalizedEvent.isRecurring,
                //     allRecurringFlags: {
                //         isRecurring: normalizedEvent.isRecurring,
                //         isRecurringEnhanced: normalizedEvent.isRecurringEnhanced,
                //         isRecurringClassic: normalizedEvent.isRecurringClassic
                //     }
                // });
                
                if (shouldExpand) {
                    recurringEventCount++;
                    // console.log(`[Fetch] 🔄 CALLING expandRecurringEvent for: "${normalizedEvent.title}" (Pattern: ${normalizedEvent.recurrencePatternText})`);
                    const reason = hasRecurrencePattern ? 'pattern' : 'flags(master)';
                    // console.log(`[Fetch] Expansion reason: ${reason}`);
                    // Expand recurring events into multiple instances
                    const recurringInstances = this.expandRecurringEvent(normalizedEvent);
                    this.events.push(...recurringInstances);
                    totalInstancesGenerated += recurringInstances.length;
                    // console.log(`[Fetch] ✅ Expanded recurring event "${normalizedEvent.title}" into ${recurringInstances.length} instances`);
                } else {
                    singleEventCount++;
                    // Add instances and true singles as-is
                    this.events.push(normalizedEvent);
                    // console.log(`[Fetch] ⏭️ Skipping expansion (${isInstanceRow ? 'instance' : 'non-recurring single'}). Added event "${normalizedEvent.title}"`);
                }
                
                eventIndex++;
            }

            // console.log('=== FETCH EVENTS SUMMARY ===');
            // console.log(`Original Events from Apex: ${raw.length}`);
            // console.log(`- Recurring Events: ${recurringEventCount}`);
            // console.log(`- Single Events: ${singleEventCount}`);
            // console.log(`Total Instances Generated: ${totalInstancesGenerated}`);
            // console.log(`Final Events Array Length: ${this.events.length}`);
            
            // console.log('[Fetch] Final events with dates:', this.events.map(e => ({
            //     key: e._key || e.id || e.Id,
            //     title: e.title,
            //     isRecurring: e.isRecurring,
            //     _start_date: e._start ? e._start.toDateString() : 'NO_START',
            //     _start_time: e._start ? e._start.toTimeString().substring(0, 8) : 'NO_TIME',
            //     _end_date: e._end ? e._end.toDateString() : 'NO_END'
            // })));

            
            // ========== EVENT SORTING OPTIMIZATION - START ==========
            const startSortTime = performance.now();
            
            // Deduplication: remove duplicate events with same time and title
            console.log('=== DEDUPLICATION ===');
            console.log(`Before deduplication: ${this.events.length} events`);
            
            const uniqueEvents = [];
            const seenEvents = new Set();
            
            this.events.forEach(event => {
                // Create unique identifier: title + start time + end time
                const uniqueKey = `${event.title}-${event._start ? event._start.getTime() : 'no-start'}-${event._end ? event._end.getTime() : 'no-end'}`;
                
                if (!seenEvents.has(uniqueKey)) {
                    seenEvents.add(uniqueKey);
                    uniqueEvents.push(event);
                } else {
                    console.log(`DUPLICATE REMOVED: "${event.title}" at ${event._start ? event._start.toTimeString() : 'NO_TIME'}`);
                }
            });
            
            this.events = uniqueEvents;
            console.log(`After deduplication: ${this.events.length} events`);
            console.log('=== END DEDUPLICATION ===');
            
            // Sort by start time, events without start time go to the end
            console.log('=== SORTING ALL EVENTS ===');
            console.log(`Before sorting: ${this.events.length} events`);
            
            this.events.sort((a, b) => {
                if (!a._start && !b._start) return 0;
                if (!a._start) return 1;  // Events without start time go to the back
                if (!b._start) return -1;
                return a._start.getTime() - b._start.getTime();
            });
            
            console.log('SORTED EVENTS LIST:');
            this.events.forEach((event, index) => {
                console.log(`${index}: "${event.title}"`);
                console.log(`   Start: ${event._start ? event._start.toDateString() + ' ' + event._start.toTimeString() : 'NO_START'}`);
                console.log(`   End: ${event._end ? event._end.toTimeString() : 'NO_END'}`);
                console.log(`   Key: ${event._key || event.id || event.Id}`);
                console.log(`   IsRecurring: ${event.isRecurring}`);
                console.log('---');
            });
            console.log('=== END SORTING ===');
            
            const sortTime = Math.round(performance.now() - startSortTime);
            
            // Update event date range info (array is now sorted)
            // ========== EVENT SORTING OPTIMIZATION - END ==========
            
            // Auto-jump to the first event's week if current week has no events
            try {
                if (this.viewMode === 'week' && this.events.length > 0) {
                    const weekStart = new Date(this.currentWeekStart);
                    weekStart.setHours(0,0,0,0);
                    const weekEnd = new Date(weekStart);
                    weekEnd.setDate(weekStart.getDate() + 6);
                    weekEnd.setHours(23,59,59,999);

                    const countThisWeek = this.events.filter(e => e._start && e._start >= weekStart && e._start <= weekEnd).length;
                    if (countThisWeek === 0) {
                        const firstEvent = this.events.filter(e => e._start).sort((a,b) => a._start - b._start)[0];
                        if (firstEvent && firstEvent._start) {
                            const d = new Date(firstEvent._start);
                            const daysFromSunday = d.getDay();
                            const newWeekStart = new Date(d);
                            newWeekStart.setDate(d.getDate() - daysFromSunday);
                            newWeekStart.setHours(0,0,0,0);
                            this.currentWeekStart = newWeekStart;
                            // console.log(`${LOG_TAG} ${LOG_VERSION} - No events in current week, auto-jumping to week of first event:`, newWeekStart.toDateString());
                        }
                    }
                }
            } catch (jumpErr) {
                // console.warn('[Fetch] Auto-jump check failed:', jumpErr);
            }

            this.refreshView();
            
            // Debug: Check if current week has events
            if (this.currentWeekStart) {
                const weekStart = new Date(this.currentWeekStart);
                weekStart.setHours(0,0,0,0);
                const weekEnd = new Date(weekStart);
                weekEnd.setDate(weekStart.getDate() + 6);
                weekEnd.setHours(23,59,59,999);
                
                const currentWeekEvents = this.events.filter(e => 
                    e._start && e._start >= weekStart && e._start <= weekEnd
                );
            }
            
            // ========== CACHE UPDATE - START ==========
            // Update cache (only after successful data fetch and processing)
            this.updateCache(this.events);
            // ========== CACHE UPDATE - END ==========
            
            this.loading = false;
        } catch (error) {
            this.handleError(error);
        } finally {
            // ========== STATE CLEANUP - START ==========
            this.isCurrentlyFetching = false;
            // ========== STATE CLEANUP - END ==========
        }
    }

    // ---------- normalization ----------
    readDate(obj, keys) {
        for (const k of keys) {
            if (obj && obj[k]) {
                const d = new Date(obj[k]);
                if (!isNaN(d.getTime())) return d;
            }
        }
        return null;
    }

   normalizeEvent(e) {
    // console.log('[NormalizeEvent] Raw event from Apex:', {
    //     id: e.id,
    //     title: e.title,
    //     isRecurring: e.isRecurring,
    //     isRecurringEnhanced: e.isRecurringEnhanced,
    //     isRecurringClassic: e.isRecurringClassic,
    //     recurrencePatternText: e.recurrencePatternText,
    //     startDateTime: e.startDateTime
    // });

    const startRawStr = e.startDateTime || e.StartDateTime || e.start || e.Start || e.start__c;
    let start = this.readDate(e, ['startDateTime','StartDateTime','start','Start','start__c']);
    let end   = this.readDate(e, ['endDateTime','EndDateTime','end','End','end__c']);

    // If date string is in UTC, convert to local time
    if (typeof startRawStr === 'string' && startRawStr.endsWith('Z')) {
        start = new Date(startRawStr);
    }

    // If date-only (no 'T'), default 9:00–9:30 so it appears in the slot grid
    if (start && typeof startRawStr === 'string' && !startRawStr.includes('T')) {
        start = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 0, 0, 0);
        end   = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 9, 30, 0, 0);
    }
    if (!end && start) end = new Date(start.getTime() + 30 * 60 * 1000);

    // Defensive: always use local time for mapping
    if (start && typeof start === 'string') {
        start = new Date(start);
    }
    if (end && typeof end === 'string') {
        end = new Date(end);
    }

    const title = e.title || e.Subject || e.Name || 'Untitled';
    const formattedStart = start
        ? start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
        : '';

    // Preserve recurring event information and additional fields
    const isRecurring = !!(e.isRecurringEnhanced || e.isRecurringClassic || e.isRecurring || e.recurrenceActivityId);
    
    // console.log('[NormalizeEvent] Determining isRecurring:', {
    //     title: title,
    //     'e.isRecurringEnhanced': e.isRecurringEnhanced,
    //     'e.isRecurringClassic': e.isRecurringClassic,
    //     'e.isRecurring': e.isRecurring,
    //     'calculated isRecurring': isRecurring
    // });
    
    const recurrenceInfo = {
        isRecurringEnhanced: e.isRecurringEnhanced || false,
        recurrencePatternText: e.recurrencePatternText || '',
        isRecurringClassic: e.isRecurringClassic || false,
        recurrenceActivityId: e.recurrenceActivityId || '',
        location: e.location || '',
        type: e.type || ''
    };

    const normalizedEvent = { 
        ...e, 
        title, 
        _start: start, 
        _end: end, 
        formattedStart,
        isRecurring,
        ...recurrenceInfo
    };

    // console.log('[NormalizeEvent] Final normalized event:', {
    //     title: normalizedEvent.title,
    //     isRecurring: normalizedEvent.isRecurring,
    //     isRecurringEnhanced: normalizedEvent.isRecurringEnhanced,
    //     recurrencePatternText: normalizedEvent.recurrencePatternText,
    //     _start: normalizedEvent._start ? normalizedEvent._start.toString() : 'NO_START'
    // });

    return normalizedEvent;
}

    // Expand a recurring event into multiple instances based on recurrence pattern
    expandRecurringEvent(event) {
        // console.log('=== EXPAND RECURRING EVENT DEBUG ===');
        // console.log('[ExpandRecurring] Event Details:', {
        //     title: event.title,
        //     id: event.id || event.Id,
        //     isRecurring: event.isRecurring,
        //     isRecurringEnhanced: event.isRecurringEnhanced,
        //     isRecurringClassic: event.isRecurringClassic,
        //     recurrencePatternText: event.recurrencePatternText,
        //     _start: event._start ? event._start.toString() : 'NO_START',
        //     _end: event._end ? event._end.toString() : 'NO_END'
        // });
        
        if (!event._start) {
            // console.warn('[ExpandRecurring] ❌ Event has no start date:', event.title);
            return [event]; // Return as single event if no start date
        }

        const instances = [];
        const maxInstances = 100; // Limit to prevent infinite loops
        const today = new Date();
        const sixMonthsFromNow = new Date();
        sixMonthsFromNow.setMonth(today.getMonth() + 6);

        // console.log('[ExpandRecurring] Date range for expansion:', {
        //     today: today.toDateString(),
        //     sixMonthsFromNow: sixMonthsFromNow.toDateString(),
        //     eventStartDate: event._start.toDateString()
        // });

        // Parse recurrence pattern if available
        let pattern = event.recurrencePatternText || '';
        // console.log('[ExpandRecurring] 🔍 Analyzing pattern (raw):', pattern);

        // Frontend fallback: if record is recurring but pattern is missing (FLS/caching/serialization),
        // assume a conservative daily pattern for 30 occurrences so events still render.
        if ((!pattern || pattern.trim().length === 0) && (event.isRecurring || event.isRecurringEnhanced || event.isRecurringClassic || event.recurrenceActivityId)) {
            // console.warn('[ExpandRecurring] ⚠️ No recurrence pattern text but recurring flags detected; applying SAFE DEFAULT RRULE (DAILY x30). Title:', event.title);
            // Extra explicit log for easier searching in console
            // console.warn('No recurrence pattern text but recurring flags');
            pattern = 'FREQ=DAILY;INTERVAL=1;COUNT=30';
        }

        // Simple daily recurrence expansion (FREQ=DAILY)
        if (pattern.includes('FREQ=DAILY')) {
            // console.log('[ExpandRecurring] ✅ Daily frequency detected');
            
            const intervalMatch = pattern.match(/INTERVAL=(\d+)/);
            const countMatch = pattern.match(/COUNT=(\d+)/);
            
            const interval = intervalMatch ? parseInt(intervalMatch[1]) : 1;
            const count = countMatch ? parseInt(countMatch[1]) : 30; // Default to 30 occurrences
            
            // console.log('[ExpandRecurring] Pattern details:', {
            //     interval: interval + ' days',
            //     count: count + ' occurrences',
            //     maxInstances: maxInstances
            // });
            
            // ========== RECURRING EVENT TIME FIX - START ==========
            // Preserve original time components to avoid DST and precision issues
            const originalHours = event._start.getHours();
            const originalMinutes = event._start.getMinutes();
            const originalSeconds = event._start.getSeconds();
            const originalMs = event._start.getMilliseconds();
            
            let currentDate = new Date(event._start);
            const duration = event._end ? (event._end.getTime() - event._start.getTime()) : (30 * 60 * 1000); // 30 min default
            
            // ========== RECURRING EVENT TIME FIX - END ==========
            
            for (let i = 0; i < Math.min(count, maxInstances); i++) {
                // Don't create instances too far in the past or future
                const sixMonthsAgo = new Date(today.getTime() - (180 * 24 * 60 * 60 * 1000));
                const inDateRange = currentDate >= sixMonthsAgo && currentDate <= sixMonthsFromNow;
                
                
                if (inDateRange) {
                    // ========== TIME PRECISION FIX - START ==========
                    // Create precise time instance, preserving original time components
                    const instanceStart = new Date(currentDate.getFullYear(), 
                                                  currentDate.getMonth(), 
                                                  currentDate.getDate(),
                                                  originalHours,
                                                  originalMinutes, 
                                                  originalSeconds, 
                                                  originalMs);
                    const instanceEnd = new Date(instanceStart.getTime() + duration);
                    // ========== TIME PRECISION FIX - END ==========
                    
                    const instance = {
                        ...event,
                        _start: instanceStart,
                        _end: instanceEnd,
                        _key: `${event.id || event.Id || 'recurring'}-instance-${i}`,
                        formattedStart: instanceStart.toLocaleTimeString('en-US', { 
                            hour: 'numeric', 
                            minute: '2-digit', 
                            hour12: true 
                        })
                    };
                    
                    instances.push(instance);
                } else {
                }
                
                // ========== DATE ADVANCEMENT FIX - START ==========
                // Safer date advancement to avoid month-end boundary issues
                const nextDate = new Date(currentDate);
                nextDate.setDate(currentDate.getDate() + interval);
                
                // Verify date advancement is correct
                const expectedDay = currentDate.getDate() + interval;
                if (nextDate.getDate() !== expectedDay && nextDate.getDate() !== (expectedDay % 31)) {
                }
                
                currentDate = nextDate;
                // ========== DATE ADVANCEMENT FIX - END ==========
            }
            
            // console.log(`[ExpandRecurring] 🎯 RESULT: Generated ${instances.length} daily instances for: "${event.title}"`);;
        }
        // Add more recurrence patterns here (weekly, monthly, etc.) as needed
        else if (pattern.includes('FREQ=WEEKLY')) {
            // console.log('[ExpandRecurring] ⚠️ Weekly frequency detected but not implemented yet');
            instances.push(event);
        }
        else if (pattern.includes('FREQ=MONTHLY')) {
            // console.log('[ExpandRecurring] ⚠️ Monthly frequency detected but not implemented yet');
            instances.push(event);
        }
        else {
            // If we can't parse the pattern, show the original event
            // console.log('[ExpandRecurring] ❓ Unknown or empty pattern, showing original event:', pattern);
            instances.push(event);
        }

        // console.log('=== EXPAND RECURRING EVENT COMPLETE ===');
        return instances;
    }

    makeEventKey(e, fallback) { 
        return (e && (e.id || e.Id)) ? (e.id || e.Id) : fallback; 
    }

    sameLocalDate(a, b) {
        if (!a || !b) return false;
        
        const result = a.getFullYear() === b.getFullYear() &&
                      a.getMonth() === b.getMonth() &&
                      a.getDate() === b.getDate();
        
        // console.log('[SameDate]', {
        //     dateA: a.toDateString(),
        //     dateB: b.toDateString(),
        //     match: result
        // });
        
        return result;
    }

    // ---------- filtering & positioning ----------
    getEventsForDate(date) {
        // console.log(`=== GET EVENTS FOR DATE: ${date.toDateString()} ===`);
        // console.log(`Total events in this.events: ${this.events.length}`);
        
        const list = this.events.filter(evt => {
            const hasStart = evt._start;
            
            if (!hasStart) {
                // console.log(`❌ Event "${evt.title}" has no start time`);
                return false;
            }
            
            const matches = this.sameLocalDate(evt._start, date);
            // if (matches) {
            //     console.log(`✅ Event "${evt.title}" matches date ${date.toDateString()}`);
            //     console.log(`   Start: ${evt._start.toDateString()} ${evt._start.toTimeString()}`);
            //     console.log(`   End: ${evt._end ? evt._end.toTimeString() : 'NO_END'}`);
            //     console.log(`   Key: ${evt._key || evt.id || evt.Id}`);
            //     console.log(`   IsRecurring: ${evt.isRecurring}`);
            // }
            return matches;
        });
        
        // console.log(`Found ${list.length} events for ${date.toDateString()}`);
        // console.log(`=== END GET EVENTS FOR DATE ===`);
        
        return list;
    }

    // ---------- view builders ----------
    refreshView() {
        if (this.viewMode === 'week') {
            this.buildWeekView();
        } else {
            this.buildMonthView();
        }
    }

    buildWeekView() {
        this.weekDays = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);

        // Build 7 days starting from Sunday of currentWeekStart
        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(this.currentWeekStart);
            currentDate.setDate(this.currentWeekStart.getDate() + i);

            const dayEventsRaw = this.getEventsForDate(currentDate);
            
            // DEBUG: Show what we got for this specific day
            // if (currentDate.getDate() === 11 && currentDate.getMonth() === 8 && currentDate.getFullYear() === 2025) {
            //     console.log(`🔥 THU 11 RAW EVENTS: ${dayEventsRaw.length} events`);
            //     dayEventsRaw.forEach((event, idx) => {
            //         console.log(`RAW ${idx}: "${event.title}"`);
            //         console.log(`   Start: ${event._start ? event._start.toDateString() + ' ' + event._start.toTimeString() : 'NO_START'}`);
            //         console.log(`   End: ${event._end ? event._end.toTimeString() : 'NO_END'}`);
            //         console.log(`   Key: ${event._key || event.id || event.Id}`);
            //         console.log(`   IsRecurring: ${event.isRecurring}`);
            //         console.log('---');
            //     });
            // }

            // SPECIAL DEBUG for Thu 11 (September 11, 2025)
            if (currentDate.getDate() === 11 && currentDate.getMonth() === 8 && currentDate.getFullYear() === 2025) {
                console.log('🔥🔥🔥 SPECIAL DEBUG FOR THU 11 (Sep 11, 2025) 🔥🔥🔥');
                console.log('[Thu11] Raw events for this day:', dayEventsRaw.length);
                console.log('[Thu11] All events details:', dayEventsRaw.map(e => ({
                    title: e.title,
                    id: e.id || e.Id,
                    _key: e._key,
                    startTime: e._start ? e._start.toString() : 'NO_START',
                    endTime: e._end ? e._end.toString() : 'NO_END',
                    isRecurring: e.isRecurring,
                    hour: e._start ? e._start.getHours() : 'NO_HOUR'
                })));
            }

            // Create hour slots for this day (5 AM to 4 AM next day) - background grid only
            const hourSlots = [];
            for (let h = 5; h < 29; h++) {
                const hour = h % 24; // Wrap around after 24
                hourSlots.push({
                    hour: hour,
                    hourLabel: this.formatHourLabel(hour)
                });
            }

            // Process all events for this day and calculate grid positions with overlap detection
            const allEvents = [];
            const seenEvents = new Set();
            
            // First pass: collect and deduplicate events
            const rawEvents = [];
            dayEventsRaw.forEach((e, idx) => {
                const eventKey = `${e.title}-${e._start ? e._start.getTime() : 'no-time'}`;
                if (seenEvents.has(eventKey)) {
                    // DEBUG: Thu 11 duplicate detection
                    if (currentDate.getDate() === 11 && currentDate.getMonth() === 8 && currentDate.getFullYear() === 2025) {
                        console.log(`DUPLICATE DETECTED: "${e.title}" with key: ${eventKey}`);
                    }
                    return; // Skip duplicates
                }
                seenEvents.add(eventKey);
                
                const k = this.makeEventKey(e, `${currentDate.getTime()}-${idx}`);
                
                // Calculate basic position and size
                let topPosition = 0;
                let height = 46; // Default height
                
                if (e._start) {
                    const startHour = e._start.getHours();
                    const startMinutes = e._start.getMinutes();
                    
                    // ========== 24-HOUR GRID POSITION FIX - START ==========
                    // Find which slot this hour corresponds to (5 AM = slot 1, 6 AM = slot 2, etc.)
                    let slotIndex = -1;
                    let matchedH = -1;
                    
                    for (let h = 5; h < 29; h++) {
                        const hour = h % 24;
                        if (hour === startHour) {
                            slotIndex = h - 5 + 1; // Convert to 1-based slot index
                            matchedH = h;
                            break;
                        }
                    }
                    
                    // Validate special time points in 24-hour grid
                    const isEarlyMorningEvent = startHour >= 0 && startHour <= 4;
                    const isRecurringEvent = e.isRecurring || false;
                    
                    // ========== 24-HOUR GRID POSITION FIX - END ==========
                    
                    if (slotIndex > 0) {
                        // Calculate precise position within the slot
                        topPosition = (slotIndex - 1) * 50 + (startMinutes / 60) * 50;
                        
                        if (e._end) {
                            const durationMs = e._end.getTime() - e._start.getTime();
                            const durationMinutes = durationMs / (1000 * 60);
                            height = Math.max(30, (durationMinutes / 60) * 50); // Minimum 30 minutes
                        }
                        
                        // ========== POSITION VALIDATION - START ==========
                        // ========== POSITION VALIDATION - END ==========
                    } else {
                    }
                }
                
                rawEvents.push({
                    ...e,
                    _key: k,
                    _topPosition: topPosition,
                    _height: height,
                    _startTime: e._start ? e._start.getTime() : 0,
                    _endTime: e._end ? e._end.getTime() : (e._start ? e._start.getTime() + 30*60*1000 : 0)
                });
            });
            
            // ========== 使用新的优化布局算法 ==========
            // Second pass: detect overlaps and calculate layout using optimized algorithm
            console.log(`[NewAlgorithm] 开始处理 ${currentDate.toDateString()} 的 ${rawEvents.length} 个事件`);
            
            const processedEvents = this.calculateOptimizedEventLayout(rawEvents, {
                enableDynamicFill: true,     // 启用动态占满空隙
                pxPerMinute: this.SLOT_HEIGHT_PX / 60,  // 每分钟像素数 (50px/60min ≈ 0.83px/min)
                minEventHeight: 30,          // 最小事件高度30px
                columnGap: 4                 // 列间距4px
            });
            
            console.log(`[NewAlgorithm] ${currentDate.toDateString()} 完成，输出 ${processedEvents.length} 个布局事件`);
            allEvents.push(...processedEvents);

            // SPECIAL DEBUG for Thu 11
            if (currentDate.getDate() === 11 && currentDate.getMonth() === 8 && currentDate.getFullYear() === 2025 && allEvents.length > 0) {
                console.log('=== THU 11 DEBUG START ===');
                
                allEvents.forEach((e, index) => {
                    console.log(`EVENT ${index}: "${e.title}"`);
                    console.log(`  Time: ${e._start ? e._start.toTimeString().substring(0, 8) : 'NO_TIME'} - ${e._end ? e._end.toTimeString().substring(0, 8) : 'NO_END'}`);
                    console.log(`  Position: top=${e._topPosition}px, height=${e._height}px`);
                    console.log(`  Layout: eventIndex=${e._eventIndex}, totalInGroup=${e._totalInGroup}, colorIndex=${e._colorIndex}`);
                    console.log(`  Column: _columnIndex=${e._columnIndex}, _totalActiveColumns=${e._totalActiveColumns}`);
                    console.log(`  Key: ${e._key}`);
                    console.log('---');
                });
                
                // Focus analysis on the last two overlapping events
                const event3 = allEvents[3];
                const event4 = allEvents[4];
                if (event3 && event4) {
                    console.log('OVERLAP ANALYSIS:');
                    console.log(`Event3 "${event3.title}": ${new Date(event3._startTime).toTimeString()} - ${new Date(event3._endTime).toTimeString()}`);
                    console.log(`  eventIndex=${event3._eventIndex}, columnIndex=${event3._columnIndex}, totalInGroup=${event3._totalInGroup}`);
                    console.log(`Event4 "${event4.title}": ${new Date(event4._startTime).toTimeString()} - ${new Date(event4._endTime).toTimeString()}`);
                    console.log(`  eventIndex=${event4._eventIndex}, columnIndex=${event4._columnIndex}, totalInGroup=${event4._totalInGroup}`);
                    console.log(`Actually overlap? ${event3._startTime < event4._endTime && event4._startTime < event3._endTime}`);
                }
                
                console.log('=== THU 11 DEBUG END ===');
            }

            this.weekDays.push({
                colIndex: i,
                date: currentDate.getDate(),
                month: currentDate.getMonth(),
                year: currentDate.getFullYear(),
                dayName: this.dayNames[i],
                dayNameShort: this.dayNamesShort[i],
                isToday: this.isSameDate(currentDate, today),
                isCurrentMonth: currentDate.getMonth() === this.currentMonth,
                dateStr: this.formatDate(currentDate),
                fullDate: new Date(currentDate),
                hourSlots: hourSlots,
                allEvents: allEvents, // New: all events positioned absolutely
                totalEvents: allEvents.length
            });
        }

        // Trigger reactive update properly
        this.weekDays = this.weekDays.slice();
    }

    calculateConcurrentEventLayout(events) {
        if (events.length === 0) return [];
        
        // Limit to maximum 4 concurrent events
        const MAX_COLUMNS = 4;
        
        // Sort by start time, if start time is same, sort by end time
        const sortedEvents = [...events].sort((a, b) => {
            if (a._startTime === b._startTime) {
                return a._endTime - b._endTime; // When start time is same, shorter events first
            }
            return a._startTime - b._startTime;
        });
        
        // console.log('[ConcurrentLayout] Step 1: Creating overlap groups');
        
        // Step 1: Create overlap event groups
        const overlapGroups = this.createOverlapGroups(sortedEvents);
        
        // console.log('[ConcurrentLayout] Found', overlapGroups.length, 'overlap groups');
        
        // Step 2: Assign columns to events within each group
        const eventColumnMap = new Map();
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
        
        overlapGroups.forEach((group, groupIndex) => {
            // console.log(`[ConcurrentLayout] Processing group ${groupIndex + 1} with ${group.length} events`);
            
            if (group.length === 1) {
                // Single event, assign to column 0
                eventColumnMap.set(group[0]._key || group[0].title, 0);
                // console.log(`[ConcurrentLayout] Single event "${group[0].title}" → Column 0`);
            } else {
                // Multiple overlapping events, use interval graph coloring algorithm
                const columnAssignments = this.assignColumnsToOverlapGroup(group, MAX_COLUMNS);
                columnAssignments.forEach((columnIndex, eventKey) => {
                    eventColumnMap.set(eventKey, columnIndex);
                });
            }
        });
        
        // console.log('[ConcurrentLayout] Step 2: Calculating dynamic widths');
        
        // Step 3: Calculate dynamic width and sorting info for each event
        const processedEvents = [];
        
        // Create start time ranking map (for z-index calculation)
        const startTimeRankMap = new Map();
        const uniqueStartTimes = [...new Set(sortedEvents.map(e => e._startTime))].sort((a, b) => a - b);
        uniqueStartTimes.forEach((startTime, index) => {
            startTimeRankMap.set(startTime, index);
        });
        
        sortedEvents.forEach(event => {
            const eventColumn = eventColumnMap.get(event._key || event.title);
            
            // Calculate how many columns are active during this event's time period
            const activeColumns = this.calculateActiveColumns(event, sortedEvents, eventColumnMap);
            const maxActiveColumns = Math.min(activeColumns, MAX_COLUMNS);
            
            // console.log(`[ConcurrentLayout] "${event.title}" in column ${eventColumn}, active columns: ${maxActiveColumns}`);
            
                processedEvents.push({
                    ...event,
                _columnIndex: eventColumn,
                _totalActiveColumns: maxActiveColumns,
                _colorIndex: eventColumn % colors.length,
                _eventIndex: eventColumn, // Compatible with existing code
                _totalInGroup: maxActiveColumns, // Compatible with existing code
                _gapPx: 2, // Column spacing
                _startTimeRank: startTimeRankMap.get(event._startTime) || 0 // New: start time ranking
            });
        });
        
        // console.log('[ConcurrentLayout] Layout complete');
        return processedEvents;
    }
    
    // Create overlap event groups
    createOverlapGroups(sortedEvents) {
        const groups = [];
        const processed = new Set();
        
        sortedEvents.forEach(event => {
            if (processed.has(event._key || event.title)) return;
            
            // Create new group containing all events that overlap with current event
            const group = [event];
            processed.add(event._key || event.title);
            
            // Find all events that overlap with current event
            sortedEvents.forEach(otherEvent => {
                if (processed.has(otherEvent._key || otherEvent.title)) return;
                
                if (this.eventsOverlap(event, otherEvent)) {
                    group.push(otherEvent);
                    processed.add(otherEvent._key || otherEvent.title);
                }
            });
            
            // Continue expanding group: find events that overlap with any event in the group
            let foundNew = true;
            while (foundNew) {
                foundNew = false;
                sortedEvents.forEach(candidateEvent => {
                    if (processed.has(candidateEvent._key || candidateEvent.title)) return;
                    
                    // Check if candidate event overlaps with any event in the group
                    const overlapsWithGroup = group.some(groupEvent => 
                        this.eventsOverlap(candidateEvent, groupEvent)
                    );
                    
                    if (overlapsWithGroup) {
                        group.push(candidateEvent);
                        processed.add(candidateEvent._key || candidateEvent.title);
                        foundNew = true;
                    }
                });
            }
            
            groups.push(group);
        });
        
        return groups;
    }
    
    // Assign columns to overlap group (optimized by event duration sorting)
    assignColumnsToOverlapGroup(group, maxColumns) {
        const columnAssignments = new Map();
        
        // Restore: sort by event duration (longest on left), also fix end time occupation issue
        const sortedGroup = [...group].sort((a, b) => {
            const durationA = a._endTime - a._startTime;
            const durationB = b._endTime - b._startTime;
            
            // Long events first (on left), short events later (on right)
            if (durationA !== durationB) {
                return durationB - durationA; // Descending: long → short
            }
            
            // If duration is same, sort by start time (earlier start on left)
            return a._startTime - b._startTime;
        });
        
        // console.log('[ConcurrentLayout] Assigning columns for overlap group (sorted by duration - longest first):', 
        //     sortedGroup.map(e => {
        //         const duration = e._endTime - e._startTime;
        //         const durationMinutes = Math.round(duration / (1000 * 60));
        //         return `"${e.title}" (${new Date(e._startTime).toLocaleTimeString()} - ${new Date(e._endTime).toLocaleTimeString()}, ${durationMinutes}min)`;
        //     }));
        
        // Track end time for each column
        const columnEndTimes = [];
        
        sortedGroup.forEach((event, index) => {
            let assignedColumn = -1;
            
            // Duration sorting strategy: longest events first assigned to leftmost available column
            // This ensures long events on left, short events on right visually
            
            // Find first available column (smart handling: consider actual event overlap)
            for (let col = 0; col < Math.min(columnEndTimes.length, maxColumns); col++) {
                // Check if current event actually overlaps with events already in this column
                const canUseColumn = event._startTime >= columnEndTimes[col];
                
                if (canUseColumn) {
                    assignedColumn = col;
                    // console.log(`[ConcurrentLayout] "${event.title}" can use column ${col} (previous event ended at ${new Date(columnEndTimes[col]).toLocaleTimeString()})`);
                    break;
            } else {
                    // Detailed logging of why this column cannot be used
                    // console.log(`[ConcurrentLayout] "${event.title}" cannot use column ${col}: starts at ${new Date(event._startTime).toLocaleTimeString()}, but column busy until ${new Date(columnEndTimes[col]).toLocaleTimeString()}`);
                }
            }
            
            // If no available column found and limit not reached, create new column
            if (assignedColumn === -1 && columnEndTimes.length < maxColumns) {
                assignedColumn = columnEndTimes.length;
                columnEndTimes.push(0);
            }
            
            // If still no column found (limit reached), use optimization strategy
            if (assignedColumn === -1) {
                // For duration-sorted events, prioritize assignment to earliest ending column
                let earliestEndTime = columnEndTimes[0];
                assignedColumn = 0;
                for (let col = 1; col < columnEndTimes.length; col++) {
                    if (columnEndTimes[col] < earliestEndTime) {
                        earliestEndTime = columnEndTimes[col];
                        assignedColumn = col;
                    }
                }
                // console.warn(`[ConcurrentLayout] Event "${event.title}" (duration: ${Math.round((event._endTime - event._startTime) / (1000 * 60))}min) forced into column ${assignedColumn} due to ${maxColumns}-column limit`);
            }
            
            // Update column end time and assignment mapping
            columnEndTimes[assignedColumn] = event._endTime;
            columnAssignments.set(event._key || event.title, assignedColumn);
            
            const duration = Math.round((event._endTime - event._startTime) / (1000 * 60));
            // console.log(`[ConcurrentLayout] "${event.title}" (${duration}min) → Column ${assignedColumn}`);
        });
        
        return columnAssignments;
    }
    
    // Calculate how many columns are active during given event time period (optimized version)
    calculateActiveColumns(targetEvent, allEvents, eventColumnMap) {
        const activeColumnIndices = new Set();
        
        // Find all events that overlap with target event and collect their column indices
        allEvents.forEach(event => {
            if (this.eventsOverlap(targetEvent, event)) {
                const columnIndex = eventColumnMap.get(event._key || event.title);
                if (columnIndex !== undefined) {
                    activeColumnIndices.add(columnIndex);
                }
            }
        });
        
        // Optimization: for partially overlapping events, calculate maximum concurrency
        const maxConcurrentAtAnyTime = this.calculateMaxConcurrentAtAnyTime(targetEvent, allEvents, eventColumnMap);
        
        // console.log(`[ActiveColumns] "${targetEvent.title}": overlap-based=${activeColumnIndices.size}, max-concurrent=${maxConcurrentAtAnyTime}`);
        
        // Return more accurate active column count
        return Math.max(activeColumnIndices.size, maxConcurrentAtAnyTime);
    }
    
    // Calculate maximum concurrency at any time point during the event
    calculateMaxConcurrentAtAnyTime(targetEvent, allEvents, eventColumnMap) {
        let maxConcurrent = 1; // At least include itself
        
        // Create time point events: start and end
        const timeEvents = [];
        
        // Add target event
        timeEvents.push({ time: targetEvent._startTime, type: 'start', event: targetEvent });
        timeEvents.push({ time: targetEvent._endTime, type: 'end', event: targetEvent });
        
        // Add all overlapping events
        allEvents.forEach(event => {
            if (event !== targetEvent && this.eventsOverlap(targetEvent, event)) {
                timeEvents.push({ time: event._startTime, type: 'start', event: event });
                timeEvents.push({ time: event._endTime, type: 'end', event: event });
            }
        });
        
        // Sort by time, end events before start events (same time)
        timeEvents.sort((a, b) => {
            if (a.time === b.time) {
                return a.type === 'end' ? -1 : 1;
            }
            return a.time - b.time;
        });
        
        let currentConcurrent = 0;
        
        // Scanline algorithm to calculate maximum concurrency
        timeEvents.forEach(timeEvent => {
            if (timeEvent.type === 'start') {
                currentConcurrent++;
                maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
            } else {
                currentConcurrent--;
            }
        });
        
        return maxConcurrent;
    }
    
    eventsOverlap(event1, event2) {
        // Two events overlap if one starts before the other ends
        const overlap = event1._startTime < event2._endTime && event2._startTime < event1._endTime;
        // if (overlap) {
        //     console.log('[Overlap] Events overlap:', {
        //         event1: event1.title,
        //         event1Time: `${new Date(event1._startTime).toTimeString().substring(0,8)} - ${new Date(event1._endTime).toTimeString().substring(0,8)}`,
        //         event2: event2.title,
        //         event2Time: `${new Date(event2._startTime).toTimeString().substring(0,8)} - ${new Date(event2._endTime).toTimeString().substring(0,8)}`
        //     });
        // }
        return overlap;
    }

    // ========== 新的事件布局算法 ==========
    // 路线：数据 → 几何 → 渲染
    // 1. 按天分桶 → 2. 切成重叠簇 → 3. 簇内列分配 → 4. 几何计算 → 5. 渲染

    /**
     * 主入口：新的事件布局算法
     * @param {Array} events - 单天内的事件列表
     * @param {Object} options - 配置选项
     * @returns {Array} 处理后的事件（包含布局信息）
     */
    calculateOptimizedEventLayout(events, options = {}) {
        if (events.length === 0) return [];
        
        const startTime = performance.now();
        
        const {
            enableDynamicFill = true,  // 是否启用动态占满空隙
            pxPerMinute = 1,          // 每分钟像素数
            minEventHeight = 20,       // 最小事件高度
            columnGap = 2             // 列间距
        } = options;

        console.log(`[OptimizedLayout] 开始处理 ${events.length} 个事件`);

        // Step 1: 数据预处理和排序
        const sortedEvents = [...events].sort((a, b) => {
            if (a._startTime === b._startTime) {
                return a._endTime - b._endTime; // 同时开始的，短的在前
            }
            return a._startTime - b._startTime;
        });

        // Step 2: 检测重叠簇（使用Union-Find算法）
        const clusters = this.detectOverlapClusters(sortedEvents);
        console.log(`[OptimizedLayout] 检测到 ${clusters.length} 个重叠簇`);

        // Step 3: 对每个簇进行区间分割列分配
        const processedEvents = [];
        let dynamicEventsCount = 0;
        
        clusters.forEach((cluster, clusterIndex) => {
            console.log(`[OptimizedLayout] 处理簇 ${clusterIndex + 1}/${clusters.length}，包含 ${cluster.length} 个事件`);
            
            if (cluster.length === 1) {
                // 单事件簇，直接分配
                const event = cluster[0];
                const layoutInfo = this.calculateEventGeometry(event, {
                    colIndex: 0,
                    totalColumns: 1,
                    pxPerMinute,
                    minEventHeight,
                    columnGap
                });
                
                processedEvents.push({
                    ...event,
                    ...layoutInfo,
                    _clusterIndex: clusterIndex,
                    _isOptimized: true
                });
            } else {
                // 多事件簇，使用区间分割算法
                const clusterLayout = this.assignColumnsWithIntervalPartitioning(
                    cluster, { enableDynamicFill, pxPerMinute, minEventHeight, columnGap }
                );
                
                clusterLayout.forEach(eventLayout => {
                    processedEvents.push({
                        ...eventLayout,
                        _clusterIndex: clusterIndex,
                        _isOptimized: true
                    });
                    
                    if (eventLayout._isDynamic) {
                        dynamicEventsCount++;
                    }
                });
            }
        });

        // 性能统计
        const endTime = performance.now();
        const layoutTime = Math.round(endTime - startTime);
        const averageClusterSize = clusters.length > 0 ? 
            Math.round(events.length / clusters.length * 10) / 10 : 0;

        // 更新性能统计
        this.performanceStats = {
            lastLayoutTime: layoutTime,
            totalEvents: events.length,
            totalClusters: clusters.length,
            averageClusterSize: averageClusterSize,
            dynamicEventsCount: dynamicEventsCount
        };

        console.log(`[OptimizedLayout] 完成，输出 ${processedEvents.length} 个布局事件`);
        console.log(`[Performance] 布局耗时: ${layoutTime}ms, 平均簇大小: ${averageClusterSize}, 动态事件: ${dynamicEventsCount}/${events.length}`);
        
        // 调试模式下输出详细信息
        if (this.debugMode) {
            this.logDetailedDebugInfo(clusters, processedEvents);
        }
        
        return processedEvents;
    }

    /**
     * 检测重叠簇 - 使用Union-Find算法
     * @param {Array} sortedEvents - 按开始时间排序的事件
     * @returns {Array} 簇数组，每个簇包含重叠的事件
     */
    detectOverlapClusters(sortedEvents) {
        if (sortedEvents.length <= 1) {
            return sortedEvents.map(event => [event]);
        }

        // 初始化Union-Find数据结构
        const parent = new Map();
        const rank = new Map();
        
        sortedEvents.forEach((event, index) => {
            parent.set(index, index);
            rank.set(index, 0);
        });

        // Union-Find辅助函数
        const find = (x) => {
            if (parent.get(x) !== x) {
                parent.set(x, find(parent.get(x))); // 路径压缩
            }
            return parent.get(x);
        };

        const union = (x, y) => {
            const rootX = find(x);
            const rootY = find(y);
            
            if (rootX !== rootY) {
                // 按秩合并
                if (rank.get(rootX) < rank.get(rootY)) {
                    parent.set(rootX, rootY);
                } else if (rank.get(rootX) > rank.get(rootY)) {
                    parent.set(rootY, rootX);
                } else {
                    parent.set(rootY, rootX);
                    rank.set(rootX, rank.get(rootX) + 1);
                }
            }
        };

        // 检测重叠关系并合并
        for (let i = 0; i < sortedEvents.length; i++) {
            for (let j = i + 1; j < sortedEvents.length; j++) {
                const event1 = sortedEvents[i];
                const event2 = sortedEvents[j];
                
                // 如果event2开始时间已经超过event1结束时间，后续事件都不会与event1重叠
                if (event2._startTime >= event1._endTime) {
                    break;
                }
                
                if (this.eventsOverlap(event1, event2)) {
                    union(i, j);
                }
            }
        }

        // 构建簇
        const clusters = new Map();
        sortedEvents.forEach((event, index) => {
            const root = find(index);
            if (!clusters.has(root)) {
                clusters.set(root, []);
            }
            clusters.get(root).push(event);
        });

        return Array.from(clusters.values());
    }

    /**
     * 区间分割列分配算法（Interval Partitioning）
     * @param {Array} cluster - 簇内的重叠事件
     * @param {Object} options - 配置选项
     * @returns {Array} 包含布局信息的事件
     */
    assignColumnsWithIntervalPartitioning(cluster, options = {}) {
        const { enableDynamicFill = true, pxPerMinute = 1, minEventHeight = 20, columnGap = 2 } = options;
        
        // 按开始时间排序（扫描线算法的前置条件）
        const sortedCluster = [...cluster].sort((a, b) => {
            if (a._startTime === b._startTime) {
                return a._endTime - b._endTime;
            }
            return a._startTime - b._startTime;
        });

        // 小顶堆（优先队列）- 用于跟踪每列的结束时间
        const columns = []; // 每个元素 {endTime, index}
        const eventColumnMap = new Map();

        // 扫描线算法
        sortedCluster.forEach((event, eventIndex) => {
            let assignedColumn = -1;

            // 查找可复用的列（结束时间 <= 当前事件开始时间）
            for (let i = 0; i < columns.length; i++) {
                if (columns[i].endTime <= event._startTime) {
                    assignedColumn = i;
                    columns[i].endTime = event._endTime;
                    break;
                }
            }

            // 如果没有可复用列，创建新列
            if (assignedColumn === -1) {
                assignedColumn = columns.length;
                columns.push({
                    endTime: event._endTime,
                    index: assignedColumn
                });
            }

            eventColumnMap.set(event._key || event.title, assignedColumn);
        });

        const totalColumns = columns.length;
        console.log(`[IntervalPartition] 簇需要 ${totalColumns} 列`);

        // 计算几何信息
        const layoutEvents = [];
        
        if (enableDynamicFill) {
            // 启用动态占满：按时间区间重新计算宽度
            const dynamicLayouts = this.calculateDynamicFillLayout(sortedCluster, eventColumnMap, {
                totalColumns, pxPerMinute, minEventHeight, columnGap
            });
            layoutEvents.push(...dynamicLayouts);
        } else {
            // 标准布局：固定列宽
            sortedCluster.forEach(event => {
                const colIndex = eventColumnMap.get(event._key || event.title);
                const layoutInfo = this.calculateEventGeometry(event, {
                    colIndex,
                    totalColumns,
                    pxPerMinute,
                    minEventHeight,
                    columnGap
                });
                
                layoutEvents.push({
                    ...event,
                    ...layoutInfo,
                    _columnIndex: colIndex,
                    _totalColumns: totalColumns
                });
            });
        }

        return layoutEvents;
    }

    /**
     * 动态占满空隙算法
     * @param {Array} sortedCluster - 排序后的簇事件
     * @param {Map} eventColumnMap - 事件到列的映射
     * @param {Object} config - 配置
     * @returns {Array} 动态布局的事件
     */
    calculateDynamicFillLayout(sortedCluster, eventColumnMap, config) {
        const { totalColumns, pxPerMinute, minEventHeight, columnGap } = config;
        
        // Step 1: 收集所有时间点
        const timePoints = new Set();
        sortedCluster.forEach(event => {
            timePoints.add(event._startTime);
            timePoints.add(event._endTime);
        });
        
        const sortedTimePoints = Array.from(timePoints).sort((a, b) => a - b);
        console.log(`[DynamicFill] 时间分割点: ${sortedTimePoints.length} 个`);

        // Step 2: 为每个时间区间计算活跃事件和动态宽度
        const timeSegments = [];
        for (let i = 0; i < sortedTimePoints.length - 1; i++) {
            const segmentStart = sortedTimePoints[i];
            const segmentEnd = sortedTimePoints[i + 1];
            const segmentMid = segmentStart + (segmentEnd - segmentStart) / 2;

            // 找到在此区间内活跃的事件
            const activeEvents = sortedCluster.filter(event => 
                event._startTime <= segmentMid && event._endTime > segmentMid
            );

            if (activeEvents.length > 0) {
                // 计算活跃列
                const activeColumns = new Set();
                activeEvents.forEach(event => {
                    const colIndex = eventColumnMap.get(event._key || event.title);
                    activeColumns.add(colIndex);
                });

                const activeCols = Array.from(activeColumns).sort((a, b) => a - b);
                
                timeSegments.push({
                    start: segmentStart,
                    end: segmentEnd,
                    activeEvents,
                    activeColumns: activeCols,
                    activeColumnCount: activeCols.length
                });
            }
        }

        // Step 3: 为每个事件计算动态几何
        const layoutEvents = [];
        
        sortedCluster.forEach(event => {
            const colIndex = eventColumnMap.get(event._key || event.title);
            
            // 找到事件覆盖的所有时间段
            const eventSegments = timeSegments.filter(segment => 
                event._startTime < segment.end && event._endTime > segment.start
            );

            if (eventSegments.length === 0) {
                // 回退到标准布局
                const layoutInfo = this.calculateEventGeometry(event, {
                    colIndex, totalColumns, pxPerMinute, minEventHeight, columnGap
                });
                layoutEvents.push({ ...event, ...layoutInfo });
                return;
            }

            // 计算动态布局参数
            let totalDynamicWidth = 0;
            let weightedLeft = 0;
            let segmentWeights = 0;

            eventSegments.forEach(segment => {
                const segmentDuration = segment.end - segment.start;
                const eventStartInSegment = Math.max(event._startTime, segment.start);
                const eventEndInSegment = Math.min(event._endTime, segment.end);
                const eventDurationInSegment = eventEndInSegment - eventStartInSegment;
                
                if (eventDurationInSegment > 0) {
                    const weight = eventDurationInSegment / segmentDuration;
                    const activeColumnIndex = segment.activeColumns.indexOf(colIndex);
                    const dynamicWidth = 100 / segment.activeColumnCount; // 百分比
                    const dynamicLeft = activeColumnIndex * dynamicWidth;
                    
                    totalDynamicWidth += dynamicWidth * weight;
                    weightedLeft += dynamicLeft * weight;
                    segmentWeights += weight;
                }
            });

            // 加权平均
            const avgWidth = segmentWeights > 0 ? totalDynamicWidth / segmentWeights : (100 / totalColumns);
            const avgLeft = segmentWeights > 0 ? weightedLeft / segmentWeights : ((colIndex / totalColumns) * 100);

            // 计算几何信息
            const layoutInfo = this.calculateEventGeometry(event, {
                colIndex,
                totalColumns,
                pxPerMinute,
                minEventHeight,
                columnGap,
                dynamicWidth: avgWidth,
                dynamicLeft: avgLeft
            });

            layoutEvents.push({
                ...event,
                ...layoutInfo,
                _columnIndex: colIndex,
                _totalColumns: totalColumns,
                _isDynamic: true,
                _segmentCount: eventSegments.length
            });
        });

        return layoutEvents;
    }

    /**
     * 几何计算：时间到像素转换
     * @param {Object} event - 事件对象
     * @param {Object} params - 布局参数
     * @returns {Object} 几何信息
     */
    calculateEventGeometry(event, params) {
        const {
            colIndex,
            totalColumns,
            pxPerMinute = 1,
            minEventHeight = 20,
            columnGap = 2,
            dynamicWidth = null,
            dynamicLeft = null
        } = params;

        // 时间转像素
        const startMinutes = event._startTime ? this.timeToMinutes(new Date(event._startTime)) : 0;
        const endMinutes = event._endTime ? this.timeToMinutes(new Date(event._endTime)) : startMinutes + 30;
        
        const top = startMinutes * pxPerMinute;
        const height = Math.max(minEventHeight, (endMinutes - startMinutes) * pxPerMinute);

        // 宽度和位置计算
        let width, left;
        
        if (dynamicWidth !== null && dynamicLeft !== null) {
            // 动态宽度
            width = `${dynamicWidth}%`;
            left = `${dynamicLeft}%`;
        } else {
            // 固定宽度
            const columnWidth = (100 - (totalColumns - 1) * (columnGap / totalColumns)) / totalColumns;
            width = `${columnWidth}%`;
            left = `${colIndex * (columnWidth + columnGap / totalColumns)}%`;
        }

        return {
            _top: top,
            _height: height,
            _width: width,
            _left: left,
            _colIndex: colIndex,
            _totalColumns: totalColumns
        };
    }

    /**
     * 将时间转换为分钟数（从一天开始计算）
     * @param {Date} date - 时间对象
     * @returns {number} 分钟数
     */
    timeToMinutes(date) {
        return date.getHours() * 60 + date.getMinutes();
    }

    /**
     * 详细调试信息输出
     * @param {Array} clusters - 簇数组
     * @param {Array} processedEvents - 处理后的事件
     */
    logDetailedDebugInfo(clusters, processedEvents) {
        console.group('[DebugInfo] 详细调试信息');
        
        // 簇信息
        console.log('📊 簇分析:');
        clusters.forEach((cluster, index) => {
            console.log(`  簇 ${index}: ${cluster.length} 个事件`);
            cluster.forEach(event => {
                console.log(`    - "${event.title}": ${new Date(event._startTime).toLocaleTimeString()} - ${new Date(event._endTime).toLocaleTimeString()}`);
            });
        });

        // 布局结果
        console.log('🎨 布局结果:');
        processedEvents.forEach(event => {
            console.log(`  "${event.title}":`, {
                cluster: event._clusterIndex,
                column: event._colIndex,
                totalCols: event._totalColumns,
                dynamic: event._isDynamic,
                geometry: {
                    top: event._top,
                    height: event._height,
                    left: event._left,
                    width: event._width
                }
            });
        });

        console.groupEnd();
    }

    /**
     * 切换调试模式
     */
    toggleDebugMode() {
        this.debugMode = !this.debugMode;
        console.log(`[Debug] 调试模式: ${this.debugMode ? '开启' : '关闭'}`);
        
        // 添加或移除调试CSS类
        const calendarElement = this.template.querySelector('.calendar-wrapper');
        if (calendarElement) {
            if (this.debugMode) {
                calendarElement.classList.add('debug-mode');
            } else {
                calendarElement.classList.remove('debug-mode');
            }
        }
        
        // 重新渲染视图以应用调试样式
        this.refreshView();
        
        return this.debugMode;
    }

    /**
     * 获取性能统计信息
     */
    getPerformanceStats() {
        return {
            ...this.performanceStats,
            cacheHitRate: this.cacheTimestamp ? '有缓存' : '无缓存',
            debugMode: this.debugMode,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * 设置全局调试工具
     */
    setupGlobalDebugTools() {
        // 将调试方法暴露到全局window对象，方便开发者控制台调用
        if (typeof window !== 'undefined') {
            // 创建全局调试对象
            window.calendarDebug = {
                // 切换调试模式
                toggleDebug: () => this.toggleDebugMode(),
                
                // 获取性能统计
                getStats: () => this.getPerformanceStats(),
                
                // 手动触发重新布局
                reLayout: () => {
                    console.log('[Debug] 手动触发重新布局');
                    this.refreshView();
                },
                
                // 显示当前事件数据
                showEvents: () => {
                    console.group('[Debug] 当前事件数据');
                    this.weekDays.forEach((day, index) => {
                        console.log(`第${index + 1}天 (${day.dateStr}): ${day.allEvents.length} 个事件`);
                        day.allEvents.forEach(event => {
                            console.log(`  - "${event.title}": 簇${event._clusterIndex || 'N/A'}, 列${event._colIndex || 'N/A'}${event._isDynamic ? ' (动态)' : ''}`);
                        });
                    });
                    console.groupEnd();
                },
                
                // 设置调试参数
                setDebugMode: (mode) => {
                    this.debugMode = mode;
                    const calendarElement = this.template.querySelector('.calendar-wrapper');
                    if (calendarElement) {
                        if (mode) {
                            calendarElement.classList.add('debug-mode');
                        } else {
                            calendarElement.classList.remove('debug-mode');
                        }
                    }
                    console.log(`[Debug] 调试模式设置为: ${mode}`);
                },
                
                // 测试不同布局算法
                testAlgorithm: (enableDynamicFill = true) => {
                    console.log(`[Debug] 测试算法，动态占满: ${enableDynamicFill}`);
                    // 重新构建当前视图
                    this.buildWeekView();
                },
                
                // 获取帮助信息
                help: () => {
                    console.log(`
🔧 日历调试工具帮助

可用命令：
  calendarDebug.toggleDebug()     - 切换调试模式
  calendarDebug.getStats()        - 获取性能统计
  calendarDebug.reLayout()        - 手动重新布局
  calendarDebug.showEvents()      - 显示当前事件数据
  calendarDebug.setDebugMode(true/false) - 设置调试模式
  calendarDebug.testAlgorithm(true/false) - 测试算法
  calendarDebug.help()            - 显示此帮助信息

示例：
  calendarDebug.toggleDebug()     // 开启/关闭调试模式
  calendarDebug.getStats()        // 查看性能统计
  calendarDebug.showEvents()      // 查看事件布局详情
                    `);
                }
            };
            
            console.log('🔧 日历调试工具已加载！输入 calendarDebug.help() 查看可用命令');
        }
    }

    formatHourLabel(hour) {
        const hour12 = ((hour + 11) % 12) + 1;
        const ampm = hour < 12 ? 'AM' : 'PM';
        return `${hour12} ${ampm}`;
    }

    buildMonthView() {
        const firstDay = new Date(this.currentYear, this.currentMonth, 1);
        const lastDay = new Date(this.currentYear, this.currentMonth + 1, 0);
        const prevLastDay = new Date(this.currentYear, this.currentMonth, 0);

        const firstDayOfWeek = firstDay.getDay();
        const lastDateOfMonth = lastDay.getDate();
        const prevLastDate = prevLastDay.getDate();

        let days = [];
        const today = new Date(); today.setHours(0,0,0,0);

        // Previous month days
        for (let i = firstDayOfWeek; i > 0; i--) {
            const date = new Date(this.currentYear, this.currentMonth - 1, prevLastDate - i + 1);
            days.push({
                date: prevLastDate - i + 1,
                isCurrentMonth: false,
                isToday: false,
                events: [],
                dateStr: this.formatDate(date),
                fullDate: date,
                cssClass: 'month-day other-month'
            });
        }

        // Current month days
        for (let i = 1; i <= lastDateOfMonth; i++) {
            const currentDate = new Date(this.currentYear, this.currentMonth, i);
            const isToday = this.isSameDate(currentDate, today);
            const dayEventsRaw = this.getEventsForDate(currentDate);
            const dayEvents = dayEventsRaw.map((e, idx) => {
                const k = this.makeEventKey(e, `${currentDate.getTime()}-${idx}`);
                return { ...e, _key: k };
            });

            days.push({
                date: i,
                isCurrentMonth: true,
                isToday,
                events: dayEvents,
                hasEvents: dayEvents.length > 0,
                dateStr: this.formatDate(currentDate),
                fullDate: currentDate,
                cssClass: isToday ? 'month-day today' : 'month-day'
            });
        }

        // Next month filler to 42 cells
        const remainingDays = 42 - days.length;
        for (let i = 1; i <= remainingDays; i++) {
            const date = new Date(this.currentYear, this.currentMonth + 1, i);
            days.push({
                date: i,
                isCurrentMonth: false,
                isToday: false,
                events: [],
                dateStr: this.formatDate(date),
                fullDate: date,
                cssClass: 'month-day other-month'
            });
        }

        // Group into weeks
        this.monthDays = [];
        for (let i = 0; i < days.length; i += 7) {
            this.monthDays.push({ days: days.slice(i, i + 7), weekNumber: Math.floor(i / 7) + 1 });
        }
    }

    // ---------- utils & handlers ----------
    isSameDate(date1, date2) {
        return date1.getDate() === date2.getDate() &&
               date1.getMonth() === date2.getMonth() &&
               date1.getFullYear() === date2.getFullYear();
    }

    formatDate(date) {
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }

    handleError(error) {
        this.loading = false;
        this.error = true;
        this.errorMessage = error?.body?.message || error?.message || 'An error occurred.';
        // eslint-disable-next-line no-console
        // console.error('[Error]', error);
    }

    handleCalendarChange(event) {
        this.selectedCalendarId = event.detail.value;
        this.calendarId = this.selectedCalendarId;
        
        // ========== CACHE OPTIMIZATION - START ==========
        // Clear cache when calendar changes because data source changed
        console.log('[Calendar] Calendar changed - clearing cache');
        this.clearCache();
        // ========== CACHE OPTIMIZATION - END ==========
        
        this.fetchEvents();
    }

    handlePrevious() {
        if (this.viewMode === 'week') {
            this.currentWeekStart.setDate(this.currentWeekStart.getDate() - 7);
            console.log('[Navigation] Previous week:', this.currentWeekStart.toDateString());
        } else {
            if (this.currentMonth === 0) { this.currentMonth = 11; this.currentYear--; }
            else { this.currentMonth--; }
            console.log('[Navigation] Previous month:', this.monthNames[this.currentMonth], this.currentYear);
        }
        
        // ========== CACHE OPTIMIZATION - START ==========
        // Smart check if need to re-fetch data
        if (this.isCacheValid()) {
            console.log('[Navigation] Using cached data for navigation');
            this.refreshView(); // Only refresh view, don't re-fetch data
        } else {
            console.log('[Navigation] Cache invalid - fetching new data');
            this.fetchEvents();
        }
        // ========== CACHE OPTIMIZATION - END ==========
    }

    handleNext() {
        if (this.viewMode === 'week') {
            this.currentWeekStart.setDate(this.currentWeekStart.getDate() + 7);
            console.log('[Navigation] Next week:', this.currentWeekStart.toDateString());
        } else {
            if (this.currentMonth === 11) { this.currentMonth = 0; this.currentYear++; }
            else { this.currentMonth++; }
            console.log('[Navigation] Next month:', this.monthNames[this.currentMonth], this.currentYear);
        }
        
        // ========== CACHE OPTIMIZATION - START ==========
        // Smart check if need to re-fetch data
        if (this.isCacheValid()) {
            console.log('[Navigation] Using cached data for navigation');
            this.refreshView(); // Only refresh view, don't re-fetch data
        } else {
            console.log('[Navigation] Cache invalid - fetching new data');
        this.fetchEvents();
        }
        // ========== CACHE OPTIMIZATION - END ==========
    }

    handleToday() {
        const today = new Date();
        this.currentMonth = today.getMonth();
        this.currentYear = today.getFullYear();
        this.initializeCurrentWeek();
        console.log('[Navigation] Today:', this.currentWeekStart.toDateString());
        
        // ========== CACHE OPTIMIZATION - START ==========
        // Smart check if need to re-fetch data
        if (this.isCacheValid()) {
            console.log('[Navigation] Using cached data for today navigation');
            this.refreshView(); // Only refresh view, don't re-fetch data
        } else {
            console.log('[Navigation] Cache invalid - fetching new data');
        this.fetchEvents();
        }
        // ========== CACHE OPTIMIZATION - END ==========
    }

    handleViewToggle() { this.showViewDropdown = !this.showViewDropdown; }

    handleViewChange(event) {
        const newView = event.currentTarget.dataset.view;
        this.viewMode = newView;
        this.showViewDropdown = false;
        this.refreshView();
    }

    handleClickOutside(event) {
        const dropdown = this.template.querySelector('.view-dropdown');
        const button = this.template.querySelector('.view-toggle-button');
        if (dropdown && !dropdown.contains(event.target) && !button.contains(event.target)) {
            this.showViewDropdown = false;
        }
    }

    handleEventClick(event) {
        event.stopPropagation();
        const targetKey = event.currentTarget.dataset.eventId;
        let eventData = this.events.find(e => String(e._key) === String(targetKey));
        if (!eventData) eventData = this.events.find(e => String(e.id || e.Id) === String(targetKey));

        const data = eventData || {};
        const start = data._start ? data._start : (data.startDateTime ? new Date(data.startDateTime) : null);
        const end = data._end ? data._end : (data.endDateTime ? new Date(data.endDateTime) : null);

        // Format the event details
        const eventName = data.title || 'Untitled Event';
        
        let dateTimeStr = '';
        if (start) {
            // Format date as "10 Jul 2025"
            const dateStr = start.toLocaleDateString('en-GB', { 
                day: 'numeric', 
                month: 'short', 
                year: 'numeric' 
            });
            
            // Format start time
            const startTimeStr = start.toLocaleTimeString('en-US', { 
                hour: 'numeric', 
                minute: '2-digit', 
                hour12: true 
            });
            
            let timeStr = startTimeStr;
            
            // Add end time if available
            if (end) {
                const endTimeStr = end.toLocaleTimeString('en-US', { 
                    hour: 'numeric', 
                    minute: '2-digit', 
                    hour12: true 
                });
                timeStr = `${startTimeStr} - ${endTimeStr}`;
            }
            
            dateTimeStr = `${dateStr}, ${timeStr}`;
        }

    // Prepare recurring event information (readable + raw details)
    const { repeatText, repeatDetails } = this.computeRepeatInfo(data);

        // Set selected event data and show custom modal
        this.selectedEvent = {
            name: eventName,
            dateTime: dateTimeStr,
            description: data.description || '',
            location: data.location || '',
            type: data.type || '',
            isRecurring: data.isRecurring || false,
            repeatText,
            repeatDetails
        };
        this.showEventModal = true;
    }

    handleCloseEventModal() {
        this.showEventModal = false;
        this.selectedEvent = {};
    }

    handleStopPropagation(event) {
        event.stopPropagation();
    }

    // ---------- helpers (modal) ----------
    computeRepeatInfo(data) {
        try {
            const isRecurring = !!data.isRecurring;
            const pattern = (data.recurrencePatternText || '').trim();
            if (!isRecurring) {
                return { repeatText: 'No', repeatDetails: '' };
            }
            if (!pattern) {
                // Recurring but no pattern text available
                return { repeatText: 'Yes', repeatDetails: 'Recurring' };
            }
            // Parse common RRULEs and produce a readable sentence
            // Strip optional 'RRULE:' prefix and normalize whitespace
            const cleaned = pattern
                .replace(/^RRULE\s*:?\s*/i, '')
                .split(';')
                .map(s => s.trim())
                .filter(Boolean);
            const parts = cleaned.reduce((acc, kv) => {
                const idx = kv.indexOf('=');
                if (idx > -1) {
                    const k = kv.substring(0, idx).trim().toUpperCase();
                    const v = kv.substring(idx + 1).trim();
                    acc[k] = v;
                }
                return acc;
            }, {});
            const freq = (parts.FREQ || '').toUpperCase();
            const interval = parseInt(parts.INTERVAL || '1', 10);
            const count = parts.COUNT ? parseInt(parts.COUNT, 10) : undefined;
            // Repeat event field should be simple 'Yes' when recurring
            const repeatText = 'Yes';

            // Build concise frequency label
            const labelMap = { DAILY: 'Daily', WEEKLY: 'Weekly', MONTHLY: 'Monthly', YEARLY: 'Yearly' };
            let details = labelMap[freq] || 'Recurring';
            // If interval > 1, show as multiplier, e.g., "Weekly (every 2)"
            if (!isNaN(interval) && interval > 1 && labelMap[freq]) {
                details += ` (every ${interval})`;
            }
            if (count && !isNaN(count)) {
                details += `, ${count} times`;
            }
            return { repeatText, repeatDetails: details };
        } catch (e) {
            // console.warn('[Modal] computeRepeatInfo failed', e);
            return { repeatText: data.isRecurring ? 'Yes' : 'No', repeatDetails: (data.recurrencePatternText || '') };
        }
    }

    // ---------- getters ----------
    get containerClass() {
        return `calendar-wrapper ${this.loading ? 'loading' : ''} ${this.error ? 'error' : ''}`;
    }

    get currentDateRange() {
        if (this.viewMode === 'week' && this.weekDays.length > 0) {
            const start = this.weekDays[0];
            const end = this.weekDays[6];
            if (start.month === end.month) {
                return `${start.date}–${end.date} ${this.monthNames[start.month]} ${start.year}`;
            } else if (start.year === end.year) {
                return `${start.date} ${this.monthNames[start.month]}–${end.date} ${this.monthNames[end.month]} ${end.year}`;
            } else {
                return `${start.date} ${this.monthNames[start.month]} ${start.year}–${end.date} ${this.monthNames[end.month]} ${end.year}`;
            }
        } else if (this.viewMode === 'month') {
            return `${this.monthNames[this.currentMonth]} ${this.currentYear}`;
        }
        return '';
    }

    get currentViewLabel() { return this.viewMode === 'week' ? 'Week' : 'Month'; }
    get isWeekView() { return this.viewMode === 'week'; }
    get isMonthView() { return this.viewMode === 'month'; }
    get dropdownClass() { return `view-dropdown ${this.showViewDropdown ? 'show' : ''}`; }
}
