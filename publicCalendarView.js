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
    }

    renderedCallback() {
        console.log('[RenderedCallback] Called with weekDays length:', this.weekDays.length);
        console.log('[RenderedCallback] Total events:', this.events.length);
        
        // Always ensure scroll functionality works
        this.ensureScrollFunctionality();
        
        // Apply grid positioning to events
        this.applyGridPositioning();
    }
    
    ensureScrollFunctionality() {
        const days = this.template.querySelector('.week-days-grid');
        const gutter = this.template.querySelector('.week-time-column');
        
        if (days && gutter) {
            console.log('[Scroll] Ensuring scroll functionality');
            console.log('[Scroll] Days element scrollHeight:', days.scrollHeight, 'clientHeight:', days.clientHeight);
            
            // Remove existing listener if any
            if (this._syncScroll) {
                days.removeEventListener('scroll', this._syncScroll);
            }
            
            // Create new scroll sync function
            this._syncScroll = () => { 
                gutter.scrollTop = days.scrollTop; 
                console.log('[Scroll] Synced to:', days.scrollTop);
            };
            
            // Add scroll listener
            days.addEventListener('scroll', this._syncScroll);
            this._scrollSynced = true;
            console.log('[Scroll] Scroll sync attached, scrollable height:', days.scrollHeight - days.clientHeight);
            
            // Make scroll methods available in console for debugging
            window.calendarScrollTo = (position) => {
                days.scrollTop = position;
                gutter.scrollTop = position;
                console.log('[Debug] Manually scrolled to:', position);
            };
            
            window.calendarScrollToBottom = () => {
                const maxScroll = days.scrollHeight - days.clientHeight;
                days.scrollTop = maxScroll;
                gutter.scrollTop = maxScroll;
                console.log('[Debug] Scrolled to bottom:', maxScroll);
            };
            
            // Auto-scroll to 4 AM only on initial load
            if (!this._hasAutoScrolled) {
                this.scrollTo4AM();
                this._hasAutoScrolled = true;
            }
        } else {
            console.warn('[Scroll] Could not find scroll elements:', { days: !!days, gutter: !!gutter });
        }
    }

    applyGridPositioning() {
        // Apply grid positioning styles to events with concurrent event layout
        const eventElements = this.template.querySelectorAll('.grid-positioned');
        console.log('[GridPositioning] Found', eventElements.length, 'event elements in DOM');
        
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
        
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
                // Basic positioning
                eventElement.style.position = 'absolute';
                eventElement.style.top = `${eventData._topPosition}px`;
                eventElement.style.height = `${eventData._height}px`;
                eventElement.style.zIndex = '10';
                
                // 简洁的并发事件布局 - 只解决重叠问题
                if (eventData._totalInGroup !== undefined && eventData._totalInGroup > 1) {
                    const containerWidth = eventElement.parentElement.clientWidth;
                    const availableWidth = containerWidth;
                    const eventWidth = Math.floor(availableWidth / eventData._totalInGroup);
                    const leftPosition = eventData._eventIndex * eventWidth;
                    
                    // 基础定位
                    eventElement.style.left = `${leftPosition}px`;
                    eventElement.style.width = `${eventWidth}px`;
                    eventElement.style.right = 'auto';
                    
                    // 应用不同颜色
                    if (eventData._colorIndex !== undefined) {
                        const color = colors[eventData._colorIndex];
                        eventElement.style.setProperty('background-color', color, 'important');
                    }
                    
                    console.log('[GridPositioning] Applied simple layout to', eventData.title, {
                        eventIndex: eventData._eventIndex,
                        totalInGroup: eventData._totalInGroup,
                        eventWidth: eventWidth,
                        leftPosition: leftPosition
                    });
                } else {
                    // 单个事件 - 全宽度
                    eventElement.style.left = '0px';
                    eventElement.style.right = '0px';
                    eventElement.style.width = 'auto';
                    
                    // 单个事件也应用颜色
                    if (eventData._colorIndex !== undefined) {
                        const color = colors[eventData._colorIndex];
                        eventElement.style.setProperty('background-color', color, 'important');
                    }
                }
            }
        });
    }

    scrollTo4AM() {
        // Our time slots go: 5 AM (index 0), 6 AM (index 1), ..., 3 AM (index 22), 4 AM (index 23)
        // So 4 AM is at index 23 in our time slots array
        const scrollPosition = 23 * this.SLOT_HEIGHT_PX;
        
        setTimeout(() => {
            const days = this.template.querySelector('.week-days-grid');
            const gutter = this.template.querySelector('.week-time-column');
            if (days && gutter) {
                console.log('[Scroll] Auto-scrolling to 4 AM at position:', scrollPosition);
                console.log('[Scroll] Available scroll height:', days.scrollHeight);
                console.log('[Scroll] Container height:', days.clientHeight);
                
                days.scrollTop = scrollPosition;
                gutter.scrollTop = scrollPosition;
                
                // Verify scroll position was set
                setTimeout(() => {
                    console.log('[Scroll] Final scroll position:', days.scrollTop);
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
        // 组件卸载时清理缓存，释放内存
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
    
    // 检查缓存是否有效
    isCacheValid() {
        const CACHE_DURATION = 5 * 60 * 1000; // 5分钟缓存
        return this.cacheTimestamp && 
               this.cacheCalendarId === this.selectedCalendarId &&
               (Date.now() - this.cacheTimestamp) < CACHE_DURATION &&
               this.cachedEvents.length > 0;
    }
    
    // 更新缓存
    updateCache(events) {
        this.cachedEvents = [...events];
        this.cacheTimestamp = Date.now();
        this.cacheCalendarId = this.selectedCalendarId;
        console.log('[Cache] Updated cache:', {
            eventsCount: this.cachedEvents.length,
            calendarId: this.cacheCalendarId,
            timestamp: new Date(this.cacheTimestamp).toLocaleString()
        });
    }
    
    // 清除缓存
    clearCache() {
        this.cachedEvents = [];
        this.cacheTimestamp = null;
        this.cacheCalendarId = null;
        console.log('[Cache] Cache cleared');
    }
    
    // 记录缓存统计信息
    logCacheStats() {
        const cacheAge = this.cacheTimestamp ? (Date.now() - this.cacheTimestamp) / 1000 : 0;
        console.log('[Cache Stats]', {
            cachedEvents: this.cachedEvents.length,
            cacheAge: Math.round(cacheAge) + 's',
            cacheValid: this.isCacheValid(),
            calendarId: this.cacheCalendarId,
            selectedCalendarId: this.selectedCalendarId
        });
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
            
            // 检查缓存是否有效
            if (this.isCacheValid()) {
                console.log('[Cache] Using cached data instead of API call');
                this.events = [...this.cachedEvents];
                this.refreshView();
                this.loading = false;
                return;
            }
            
            // 避免并发请求
            if (this.isCurrentlyFetching) {
                console.log('[Fetch] Request already in progress, skipping duplicate call');
                return;
            }
            
            this.isCurrentlyFetching = true;
            console.log('[Cache] Cache miss - making API call');
            // ========== CACHE CHECK - END ==========
            
            this.loading = true;
            this.error = false;

            console.log(`${LOG_TAG} ${LOG_VERSION} === FETCH EVENTS DEBUG START ===`);
            console.log(`${LOG_TAG} ${LOG_VERSION} - fetchEvents invoked`);
            console.log('[Fetch] Using selectedCalendarId:', this.selectedCalendarId);
            console.log('[Fetch] Current week start:', this.currentWeekStart ? this.currentWeekStart.toDateString() : 'Not set');
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

            console.log('=== FETCH EVENTS DEBUG END ===');
            console.log('[Fetch] Total processed events:', this.events.length);
            
            // ========== EVENT SORTING OPTIMIZATION - START ==========
            console.log('[Sort] Sorting events by date for better performance...');
            const startSortTime = performance.now();
            
            // 按开始时间排序，没有开始时间的事件排到最后
            this.events.sort((a, b) => {
                if (!a._start && !b._start) return 0;
                if (!a._start) return 1;  // 没有开始时间的排到后面
                if (!b._start) return -1;
                return a._start.getTime() - b._start.getTime();
            });
            
            const sortTime = Math.round(performance.now() - startSortTime);
            console.log(`[Sort] Sorted ${this.events.length} events in ${sortTime}ms`);
            
            // 更新事件日期范围信息（现在数组已排序）
            console.log('[Fetch] Events date range:', this.events.length > 0 ? 
                `${this.events[0]._start?.toDateString()} to ${this.events[this.events.length-1]._start?.toDateString()}` : 'No events');
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
                console.log(`[Fetch] Current week (${weekStart.toDateString()} - ${weekEnd.toDateString()}) has ${currentWeekEvents.length} events`);
                if (currentWeekEvents.length > 0) {
                    console.log('[Fetch] Current week events:', currentWeekEvents.map(e => ({
                        title: e.title,
                        start: e._start.toDateString()
                    })));
                }
            }
            
            // ========== CACHE UPDATE - START ==========
            // 更新缓存（仅在成功获取和处理数据后）
            this.updateCache(this.events);
            // ========== CACHE UPDATE - END ==========
            
            this.loading = false;
        } catch (error) {
            console.error('[Fetch] ERROR:', error);
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
            
            let currentDate = new Date(event._start);
            const duration = event._end ? (event._end.getTime() - event._start.getTime()) : (30 * 60 * 1000); // 30 min default
            
            // console.log('[ExpandRecurring] Duration calculation:', {
            //     startTime: event._start.toString(),
            //     endTime: event._end ? event._end.toString() : 'NO_END',
            //     durationMs: duration,
            //     durationMinutes: duration / (60 * 1000)
            // });
            
            for (let i = 0; i < Math.min(count, maxInstances); i++) {
                // Don't create instances too far in the past or future
                const sixMonthsAgo = new Date(today.getTime() - (180 * 24 * 60 * 60 * 1000));
                const inDateRange = currentDate >= sixMonthsAgo && currentDate <= sixMonthsFromNow;
                
                // console.log(`[ExpandRecurring] Instance ${i + 1}:`, {
                //     date: currentDate.toDateString(),
                //     time: currentDate.toTimeString().substring(0, 8),
                //     inDateRange: inDateRange,
                //     sixMonthsAgo: sixMonthsAgo.toDateString(),
                //     sixMonthsForward: sixMonthsFromNow.toDateString()
                // });
                
                if (inDateRange) {
                    const instanceStart = new Date(currentDate);
                    const instanceEnd = new Date(currentDate.getTime() + duration);
                    
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
                    // console.log(`[ExpandRecurring] ✅ Generated instance ${instances.length}:`, {
                    //     title: instance.title,
                    //     key: instance._key,
                    //     start: instance._start.toDateString() + ' ' + instance._start.toTimeString().substring(0, 8),
                    //     end: instance._end.toDateString() + ' ' + instance._end.toTimeString().substring(0, 8)
                    // });
                } else {
                    // console.log(`[ExpandRecurring] ⏭️ Skipped instance ${i + 1} (outside date range)`);
                }
                
                // Move to next occurrence
                currentDate.setDate(currentDate.getDate() + interval);
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
        // Only debug for Thu 11
        const isDebugDate = date.getDate() === 11 && date.getMonth() === 8 && date.getFullYear() === 2025;
        if (isDebugDate) {
            console.log('=== GET EVENTS FOR DATE DEBUG (Thu 11) ===');
            console.log('[GetEvents] 🔍 Looking for events on:', date.toDateString());
            console.log('[GetEvents] Total events in array:', this.events.length);
        }
        
        const list = this.events.filter(evt => {
            const hasStart = evt._start;
            
            if (!hasStart) {
                if (isDebugDate) console.log('[GetEvents] ❌ Event has no start date:', evt.title);
                return false;
            }
            
            const matches = this.sameLocalDate(evt._start, date);
            
            if (isDebugDate) {
                console.log('[GetEvents] Checking event:', {
                    title: evt.title,
                    key: evt._key || evt.id || evt.Id,
                    isRecurring: evt.isRecurring,
                    eventDate: evt._start.toDateString(),
                    eventTime: evt._start.toTimeString().substring(0, 8),
                    targetDate: date.toDateString(),
                    matches: matches ? '✅' : '❌'
                });
            }
            
            return matches;
        });
        
        if (isDebugDate) {
            console.log(`[GetEvents] 🎯 RESULT: Found ${list.length} events for ${date.toDateString()}`);
            if (list.length > 0) {
                console.log('[GetEvents] Found events:', list.map(e => ({
                    title: e.title,
                    key: e._key || e.id || e.Id,
                    start: e._start.toTimeString().substring(0, 8),
                    isRecurring: e.isRecurring
                })));
            }
            console.log('=== GET EVENTS FOR DATE COMPLETE ===');
        }
        
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
        console.log('=== BUILD WEEK VIEW START ===');
        console.log('[BuildWeek] Current weekDays length before:', this.weekDays.length);
        this.weekDays = [];
        const today = new Date(); today.setHours(0, 0, 0, 0);

        console.log('[BuildWeek] Starting with currentWeekStart:', this.currentWeekStart.toDateString());
        console.log('[BuildWeek] All events available:', this.events.length);

        // Build 7 days starting from Sunday of currentWeekStart
        for (let i = 0; i < 7; i++) {
            const currentDate = new Date(this.currentWeekStart);
            currentDate.setDate(this.currentWeekStart.getDate() + i);

            const dayEventsRaw = this.getEventsForDate(currentDate);
            
            // Only log for non-Thu-11 days if needed for debugging
            // console.log(`[BuildWeek] Day ${i}: ${currentDate.toDateString()}`);
            // console.log(`[BuildWeek] Events for ${currentDate.toDateString()}:`, dayEventsRaw.length);

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
                if (seenEvents.has(eventKey)) return; // Skip duplicates
                seenEvents.add(eventKey);
                
                const k = this.makeEventKey(e, `${currentDate.getTime()}-${idx}`);
                
                // Calculate basic position and size
                let topPosition = 0;
                let height = 46; // Default height
                
                if (e._start) {
                    const startHour = e._start.getHours();
                    const startMinutes = e._start.getMinutes();
                    
                    // Find which slot this hour corresponds to (5 AM = slot 1, 6 AM = slot 2, etc.)
                    let slotIndex = -1;
                    for (let h = 5; h < 29; h++) {
                        const hour = h % 24;
                        if (hour === startHour) {
                            slotIndex = h - 5 + 1; // Convert to 1-based slot index
                            break;
                        }
                    }
                    
                    if (slotIndex > 0) {
                        // Calculate precise position within the slot
                        topPosition = (slotIndex - 1) * 50 + (startMinutes / 60) * 50;
                        
                        if (e._end) {
                            const durationMs = e._end.getTime() - e._start.getTime();
                            const durationMinutes = durationMs / (1000 * 60);
                            height = Math.max(30, (durationMinutes / 60) * 50); // Minimum 30 minutes
                        }
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
            
            // Second pass: detect overlaps and calculate layout
            const processedEvents = this.calculateConcurrentEventLayout(rawEvents);
            allEvents.push(...processedEvents);

            // SPECIAL DEBUG for Thu 11
            if (currentDate.getDate() === 11 && currentDate.getMonth() === 8 && currentDate.getFullYear() === 2025 && allEvents.length > 0) {
                console.log('🔥🔥🔥 SPECIAL DEBUG FOR THU 11 - ALL EVENTS 🔥🔥🔥');
                console.log('[Thu11] All events for this day:', allEvents.map(e => ({
                    title: e.title,
                    _key: e._key,
                    startTime: e._start ? e._start.toTimeString().substring(0, 8) : 'NO_TIME',
                    endTime: e._end ? e._end.toTimeString().substring(0, 8) : 'NO_END',
                    topPosition: e._topPosition + 'px',
                    height: e._height + 'px',
                    eventIndex: e._eventIndex,
                    totalInGroup: e._totalInGroup,
                    colorIndex: e._colorIndex
                })));
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

        console.log('[BuildWeek] Final weekDays length:', this.weekDays.length);
        console.log('[BuildWeek] Final weekDays summary:', this.weekDays.map(d => ({
            dateStr: d.dateStr,
            totalEvents: d.totalEvents,
            allEventsCount: d.allEvents ? d.allEvents.length : 0
        })));
        
        // Force LWC to detect the change by creating a new array reference
        this.weekDays = [...this.weekDays];
        console.log('[BuildWeek] Forced weekDays array update');
        console.log('=== BUILD WEEK VIEW COMPLETE ===');
    }

    calculateConcurrentEventLayout(events) {
        console.log('[ConcurrentLayout] Processing', events.length, 'events for improved column-based layout');
        
        if (events.length === 0) return [];
        
        // 限制最多4个并发事件
        const MAX_COLUMNS = 4;
        
        // 按开始时间排序，如果开始时间相同，按结束时间排序
        const sortedEvents = [...events].sort((a, b) => {
            if (a._startTime === b._startTime) {
                return a._endTime - b._endTime; // 开始时间相同时，短事件优先
            }
            return a._startTime - b._startTime;
        });
        
        console.log('[ConcurrentLayout] Step 1: Creating overlap groups');
        
        // 第一步：创建重叠事件组
        const overlapGroups = this.createOverlapGroups(sortedEvents);
        
        console.log('[ConcurrentLayout] Found', overlapGroups.length, 'overlap groups');
        
        // 第二步：为每个组内的事件分配列
        const eventColumnMap = new Map();
        const colors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
        
        overlapGroups.forEach((group, groupIndex) => {
            console.log(`[ConcurrentLayout] Processing group ${groupIndex + 1} with ${group.length} events`);
            
            if (group.length === 1) {
                // 单个事件，分配到列0
                eventColumnMap.set(group[0]._key || group[0].title, 0);
                console.log(`[ConcurrentLayout] Single event "${group[0].title}" → Column 0`);
            } else {
                // 多个重叠事件，使用区间图着色算法
                const columnAssignments = this.assignColumnsToOverlapGroup(group, MAX_COLUMNS);
                columnAssignments.forEach((columnIndex, eventKey) => {
                    eventColumnMap.set(eventKey, columnIndex);
                });
            }
        });
        
        console.log('[ConcurrentLayout] Step 2: Calculating dynamic widths');
        
        // 第三步：为每个事件计算动态宽度和排序信息
        const processedEvents = [];
        
        // 创建开始时间排序映射（用于z-index计算）
        const startTimeRankMap = new Map();
        const uniqueStartTimes = [...new Set(sortedEvents.map(e => e._startTime))].sort((a, b) => a - b);
        uniqueStartTimes.forEach((startTime, index) => {
            startTimeRankMap.set(startTime, index);
        });
        
        sortedEvents.forEach(event => {
            const eventColumn = eventColumnMap.get(event._key || event.title);
            
            // 计算在此事件时间段内有多少列是活跃的
            const activeColumns = this.calculateActiveColumns(event, sortedEvents, eventColumnMap);
            const maxActiveColumns = Math.min(activeColumns, MAX_COLUMNS);
            
            console.log(`[ConcurrentLayout] "${event.title}" in column ${eventColumn}, active columns: ${maxActiveColumns}`);
            
            processedEvents.push({
                ...event,
                _columnIndex: eventColumn,
                _totalActiveColumns: maxActiveColumns,
                _colorIndex: eventColumn % colors.length,
                _eventIndex: eventColumn, // 兼容现有代码
                _totalInGroup: maxActiveColumns, // 兼容现有代码  
                _gapPx: 2, // 列间间距
                _startTimeRank: startTimeRankMap.get(event._startTime) || 0 // 新增：开始时间排序
            });
        });
        
        console.log('[ConcurrentLayout] Layout complete');
        return processedEvents;
    }
    
    // 创建重叠事件组
    createOverlapGroups(sortedEvents) {
        const groups = [];
        const processed = new Set();
        
        sortedEvents.forEach(event => {
            if (processed.has(event._key || event.title)) return;
            
            // 创建新组，包含与当前事件重叠的所有事件
            const group = [event];
            processed.add(event._key || event.title);
            
            // 查找所有与当前事件重叠的事件
            sortedEvents.forEach(otherEvent => {
                if (processed.has(otherEvent._key || otherEvent.title)) return;
                
                if (this.eventsOverlap(event, otherEvent)) {
                    group.push(otherEvent);
                    processed.add(otherEvent._key || otherEvent.title);
                }
            });
            
            // 继续扩展组：查找与组内任何事件重叠的事件
            let foundNew = true;
            while (foundNew) {
                foundNew = false;
                sortedEvents.forEach(candidateEvent => {
                    if (processed.has(candidateEvent._key || candidateEvent.title)) return;
                    
                    // 检查候选事件是否与组内任何事件重叠
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
    
    // 为重叠事件组分配列（按事件长度排序优化）
    assignColumnsToOverlapGroup(group, maxColumns) {
        const columnAssignments = new Map();
        
        // 恢复：按事件长度排序（最长的放左边），同时修复结束时间占位问题
        const sortedGroup = [...group].sort((a, b) => {
            const durationA = a._endTime - a._startTime;
            const durationB = b._endTime - b._startTime;
            
            // 长事件优先（放左边），短事件后面（放右边）
            if (durationA !== durationB) {
                return durationB - durationA; // 降序：长 → 短
            }
            
            // 如果长度相同，按开始时间排序（早开始的在左边）
            return a._startTime - b._startTime;
        });
        
        console.log('[ConcurrentLayout] Assigning columns for overlap group (sorted by duration - longest first):', 
            sortedGroup.map(e => {
                const duration = e._endTime - e._startTime;
                const durationMinutes = Math.round(duration / (1000 * 60));
                return `"${e.title}" (${new Date(e._startTime).toLocaleTimeString()} - ${new Date(e._endTime).toLocaleTimeString()}, ${durationMinutes}min)`;
            }));
        
        // 跟踪每列的结束时间
        const columnEndTimes = [];
        
        sortedGroup.forEach((event, index) => {
            let assignedColumn = -1;
            
            // 按长度排序策略：最长事件优先分配到最左边的可用列
            // 这样确保长事件在左边，短事件在右边的视觉效果
            
            // 寻找第一个可用的列（智能处理：考虑事件真实重叠情况）
            for (let col = 0; col < Math.min(columnEndTimes.length, maxColumns); col++) {
                // 检查当前事件是否与该列中已有的事件真正重叠
                const canUseColumn = event._startTime >= columnEndTimes[col];
                
                if (canUseColumn) {
                    assignedColumn = col;
                    console.log(`[ConcurrentLayout] "${event.title}" can use column ${col} (previous event ended at ${new Date(columnEndTimes[col]).toLocaleTimeString()})`);
                    break;
                } else {
                    // 详细记录为什么不能使用这个列
                    console.log(`[ConcurrentLayout] "${event.title}" cannot use column ${col}: starts at ${new Date(event._startTime).toLocaleTimeString()}, but column busy until ${new Date(columnEndTimes[col]).toLocaleTimeString()}`);
                }
            }
            
            // 如果没找到可用列且未达到限制，创建新列
            if (assignedColumn === -1 && columnEndTimes.length < maxColumns) {
                assignedColumn = columnEndTimes.length;
                columnEndTimes.push(0);
            }
            
            // 如果仍未找到列（达到限制），采用优化策略
            if (assignedColumn === -1) {
                // 对于按长度排序的事件，优先分配到最早结束的列
                let earliestEndTime = columnEndTimes[0];
                assignedColumn = 0;
                for (let col = 1; col < columnEndTimes.length; col++) {
                    if (columnEndTimes[col] < earliestEndTime) {
                        earliestEndTime = columnEndTimes[col];
                        assignedColumn = col;
                    }
                }
                console.warn(`[ConcurrentLayout] Event "${event.title}" (duration: ${Math.round((event._endTime - event._startTime) / (1000 * 60))}min) forced into column ${assignedColumn} due to ${maxColumns}-column limit`);
            }
            
            // 更新列的结束时间和分配映射
            columnEndTimes[assignedColumn] = event._endTime;
            columnAssignments.set(event._key || event.title, assignedColumn);
            
            const duration = Math.round((event._endTime - event._startTime) / (1000 * 60));
            console.log(`[ConcurrentLayout] "${event.title}" (${duration}min) → Column ${assignedColumn}`);
        });
        
        return columnAssignments;
    }
    
    // 计算在给定事件时间段内有多少列是活跃的（优化版本）
    calculateActiveColumns(targetEvent, allEvents, eventColumnMap) {
        const activeColumnIndices = new Set();
        
        // 找到所有与目标事件重叠的事件，并收集它们的列索引
        allEvents.forEach(event => {
            if (this.eventsOverlap(targetEvent, event)) {
                const columnIndex = eventColumnMap.get(event._key || event.title);
                if (columnIndex !== undefined) {
                    activeColumnIndices.add(columnIndex);
                }
            }
        });
        
        // 优化：对于部分重叠的事件，计算最大并发数
        const maxConcurrentAtAnyTime = this.calculateMaxConcurrentAtAnyTime(targetEvent, allEvents, eventColumnMap);
        
        console.log(`[ActiveColumns] "${targetEvent.title}": overlap-based=${activeColumnIndices.size}, max-concurrent=${maxConcurrentAtAnyTime}`);
        
        // 返回更精确的活跃列数量
        return Math.max(activeColumnIndices.size, maxConcurrentAtAnyTime);
    }
    
    // 计算在事件的任何时间点的最大并发数
    calculateMaxConcurrentAtAnyTime(targetEvent, allEvents, eventColumnMap) {
        let maxConcurrent = 1; // 至少包含自己
        
        // 创建时间点事件：开始和结束
        const timeEvents = [];
        
        // 添加目标事件
        timeEvents.push({ time: targetEvent._startTime, type: 'start', event: targetEvent });
        timeEvents.push({ time: targetEvent._endTime, type: 'end', event: targetEvent });
        
        // 添加所有重叠的事件
        allEvents.forEach(event => {
            if (event !== targetEvent && this.eventsOverlap(targetEvent, event)) {
                timeEvents.push({ time: event._startTime, type: 'start', event: event });
                timeEvents.push({ time: event._endTime, type: 'end', event: event });
            }
        });
        
        // 按时间排序，结束事件在开始事件之前（相同时间）
        timeEvents.sort((a, b) => {
            if (a.time === b.time) {
                return a.type === 'end' ? -1 : 1;
            }
            return a.time - b.time;
        });
        
        let currentConcurrent = 0;
        
        // 扫描线算法计算最大并发数
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
        if (overlap) {
            console.log('[Overlap] Events overlap:', {
                event1: event1.title,
                event1Time: `${new Date(event1._startTime).toTimeString().substring(0,8)} - ${new Date(event1._endTime).toTimeString().substring(0,8)}`,
                event2: event2.title,
                event2Time: `${new Date(event2._startTime).toTimeString().substring(0,8)} - ${new Date(event2._endTime).toTimeString().substring(0,8)}`
            });
        }
        return overlap;
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
        // 切换日历时清除缓存，因为数据来源变了
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
        // 智能检查是否需要重新获取数据
        if (this.isCacheValid()) {
            console.log('[Navigation] Using cached data for navigation');
            this.refreshView(); // 只刷新视图，不重新获取数据
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
        // 智能检查是否需要重新获取数据
        if (this.isCacheValid()) {
            console.log('[Navigation] Using cached data for navigation');
            this.refreshView(); // 只刷新视图，不重新获取数据
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
        // 智能检查是否需要重新获取数据
        if (this.isCacheValid()) {
            console.log('[Navigation] Using cached data for today navigation');
            this.refreshView(); // 只刷新视图，不重新获取数据
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