	let _initiated = 0;
	let _audio_ctx = null;
	
	let _sample_rate = 16000;
	let _sample_rate_req = 16000;	// Requested sample rate, will be active on audiounit_init
	let _play_mode = 0;				// 0: normal, play immediate, 1: timer, 2: on_end_event			
	let _output_stereo_mode = 0;	// 0: mono, 1-n: stereo with different settings
	
	let _volume = 1.0;
	let _note_duration_ms = 1000;	// 0: continuous tone, for flute or organ
	let _timer_frame_ms = 160;		// Must be multiple of 16, for synchronization with browsers audio_context.currentTime (audio_context.currentTime increases by 8)
	let _event_frame_ms = 160;
	
	let _buffer_full_notes = [];
	let _buffer_event = null;
	let _buffer_timers = [];
	let _buffer_timers_cur = 0;	
	let _buffer_full_notes_cur = 0;

	let _q = [], _q2 = [], _q_pos = 0;
	let _harmonic_amps = [0.125,0.25,0.1,0.64];
	
	let _note_request_ms = [];
	let _next_play_ms = 0;
	
	let _event_state = 0;	//1: playing, busy (applicable in event_based play mode only)
	
	let _timer_running_id = 1;
	let _timer_note_q = [];
	let _timer_note_q_opts = [];
	
	let _continuous_note_q = [];
	
	function current_time_ms(){
		return (Date.now() & 0x7FFFFFFF);
	}

	async function sleep(msec) {
		return new Promise(resolve => setTimeout(resolve, msec));
	}
	
	async function audiounit_run_background_timer(tid){		
		while(1){
			if ( _play_mode != 1 )break;
			if ( _timer_running_id != tid ){
				console.log('stopping extra timer');
				break;
			}
			
			if ( _next_play_ms <= 0 ){
				await sleep(40);
				continue;
			}
			
			let t_ms = current_time_ms();
			if ( ( _next_play_ms - t_ms ) > 50 ){
				await sleep(_next_play_ms - t_ms - 50);
			}
			
			t_ms = current_time_ms();
			if ( audiounit_is_continuous_tone_enabled() == 1 ){				
				audiounit_push_continuous_notes();
			}else if ( _timer_note_q.length > 0 ){
				for ( var i = 0; i < _timer_note_q.length; i++ )_note_request_ms[i] = parseInt( _note_request_ms[i] - _next_play_ms + _timer_frame_ms );
				audiounit_push_pcm_from_notes(_timer_note_q, _timer_note_q_opts, _note_request_ms);
				_timer_note_q = [];
			}
			
			let has_audio = audiounit_load_pcm_to_buffer(_buffer_timers[_buffer_timers_cur], parseInt((_sample_rate * _timer_frame_ms)/1000));
			if ( has_audio == 0 && audiounit_buffer_is_empty() == 1 ){
				_next_play_ms = 0;
				continue;
			}
			
			t_ms = current_time_ms();
			if ( _next_play_ms > t_ms ){
				await sleep(_next_play_ms - t_ms);
			}
			
			audiounit_play_buffer(_buffer_timers[_buffer_timers_cur], 0);
			_buffer_timers_cur = ( _buffer_timers_cur + 1 ) % _buffer_timers.length;
			_next_play_ms += _timer_frame_ms;
		}
	}

	function audiounit_init(){
		_initiated = 2;
				
		_audio_ctx = new (window.AudioContext || window.webkitAudioContext)({sampleRate:_sample_rate_req});
		_sample_rate = _audio_ctx.sampleRate;
		
		audiounit_set_output_settings(_output_stereo_mode, _note_duration_ms);		
		audiounit_set_play_mode(_play_mode);
		
		_continuous_note_q = [];
		_timer_note_q = [];
		
		_initiated = 1;
		console.log('Init settings = ' + _audio_ctx.sampleRate + '/s, ' + parseInt((_sample_rate * _timer_frame_ms)/1000) + ' / ' + parseInt((_sample_rate * _note_duration_ms)/1000));
	}

	function audiounit_is_continuous_tone_enabled(){
		if ( _note_duration_ms <= 0 )return 1;
		return 0;
	}
	
	function audiounit_set_volume(vol){
		if ( vol < 0.1 )_volume = 0.1;
		else if ( vol > 1.0 )_volume = 1.0;
		else _volume = vol;
	}
	
	function audiounit_set_harmonic_amps(hh){
		_harmonic_amps = [];
		if ( hh.length == 1 && hh[0].toLowerCase().trim() == 'none' )return;
		
		let n = 0;
		for ( var i = 0; i < hh.length && i < 6; i++ ){			
			let h = parseFloat(hh[i]);
			if ( h < 0 )h = parseFloat(0-h);			
			if ( h > 1.0 )h = 1.0;
			_harmonic_amps[n++] = h;
		}
	}
	
	function audiounit_set_sample_rate(rt){
		_sample_rate_req = rt;
		if ( _initiated )alert('This sample rate will be active after you click start button.');
	}
	
	function audiounit_set_output_settings(out_mode, dur_ms){
		dur_ms = parseInt(dur_ms);
		out_mode = parseInt(out_mode);
		
		if ( dur_ms == 0 );
		else if ( dur_ms < 500 )dur_ms = 500;
		else if ( dur_ms > 2000 )dur_ms = 2000;
		
		let stereo_changed = ((( _output_stereo_mode < 1 && out_mode < 1 ) || ( _output_stereo_mode >= 1 && out_mode >= 1 )) ? 0 : 1 );
		_output_stereo_mode = out_mode;
		_note_duration_ms = dur_ms;
		
		if ( _initiated == 2 );	// 2 => Under initiation process, so don't count change.
		else if ( _note_duration_ms == dur_ms && stereo_changed == 0 )return;
		else if ( !_initiated )return;
		
		let qlen = parseInt((_sample_rate * _note_duration_ms * 2)/1000);
		if ( _note_duration_ms == 0 )qlen = parseInt(_sample_rate * 2);
		
		_q = [];
		_q2 = [];
		for ( var i = 0; i < qlen; i++ )_q[i] = 0.0;
		for ( var i = 0; i < qlen; i++ )_q2[i] = 0.0;
		_q_pos = 0;
		
		let chnl_cnt = ( _output_stereo_mode >= 1 ? 2 : 1 );
		_buffer_event = _audio_ctx.createBuffer(chnl_cnt, parseInt((_sample_rate * _event_frame_ms)/1000), _sample_rate);
		
		_buffer_timers = [];
		for ( var i = 0; i < 2; i++ ){
			_buffer_timers[i] = _audio_ctx.createBuffer(chnl_cnt, parseInt((_sample_rate * _timer_frame_ms)/1000), _sample_rate);
		}
		
		_buffer_full_notes = [];
		for ( var i = 0; i < 10 && _note_duration_ms > 0; i++ ){
			_buffer_full_notes[i] = _audio_ctx.createBuffer(chnl_cnt, parseInt((_sample_rate * _note_duration_ms)/1000), _sample_rate);			
		}
		
		_buffer_timers_cur = 0;
		_buffer_full_notes_cur = 0;		
	}
	
	function audiounit_set_play_mode(play_mode){
		if ( play_mode < 0 || play_mode > 2 )return;
		if ( play_mode == 0 && _note_duration_ms == 0 ){			
			alert('Warning: For flute/organ mode, please set play mode = timer or event');
			return;
		}
		
		if ( play_mode == _play_mode && _initiated != 2 )return;
		
		_play_mode = play_mode;
		_timer_note_q = [];
		
		if ( !_initiated )return;		
		
		if ( _play_mode == 1 )audiounit_run_background_timer(++_timer_running_id);
		else if ( _play_mode == 2 )_event_state = 0;
	}

	function audiounit_buffer_is_empty(){
		let qlen = _q.length;
		for ( var i = 0; i < qlen; i++ ){
			if ( Math.abs(_q[i]) > 0.001 )return 0;
		}
		
		if ( _output_stereo_mode >= 1 ){
			for ( var i = 0; i < qlen; i++ )if ( Math.abs(_q2[i]) > 0.001 )return 0;
		}
		
		return 1;
	}
	
	function audiounit_event_ended(){
		_event_state = 0;
		if ( _play_mode != 2 )return;
		
		if ( audiounit_is_continuous_tone_enabled() != 0 ){
			audiounit_push_continuous_notes();
		}

		let has_audio = audiounit_load_pcm_to_buffer(_buffer_event, parseInt((_sample_rate * _event_frame_ms)/1000));
		if ( has_audio == 0 ){
			if ( audiounit_buffer_is_empty() == 1 )return;
		}
		
		_event_state = 1;
		audiounit_play_buffer(_buffer_event, 0);
	}
	
	function audiounit_play_buffer(buf, t_delay_ms){
		t_delay_ms = parseInt(t_delay_ms);
		
		let source = _audio_ctx.createBufferSource();
        source.buffer = buf;
		source.connect(_audio_ctx.destination);
		
		if ( _play_mode != 2 && t_delay_ms > 0 ){
			let ff = _audio_ctx.currentTime + parseFloat(t_delay_ms/1000.0);
			source.start(ff);
		}else source.start();
		
		if ( _play_mode == 2 ){
			_next_play_ms = current_time_ms() + _event_frame_ms;
			source.addEventListener('ended', audiounit_event_ended, false);
		}
	}
	
	function audiounit_load_pcm_to_buffer(buf, frame_count){
		let stereo_mode = ( buf.numberOfChannels > 1 ? 1 : 0 );
		if ( _output_stereo_mode < 1 )stereo_mode = 0;
		
		let cur_buf = buf.getChannelData(0);
		let cur_buf2 = ( stereo_mode == 1 ? buf.getChannelData(1) : null );
		let has_audio = 0;
		let qlen = _q.length;
		
		let dt2 = 0.0;
		for ( var i = 0; i < frame_count; i++ ){
			let dt = _q[_q_pos];
			_q[_q_pos] = 0.0;
			cur_buf[i] = dt;			
			if ( stereo_mode == 1 ){
				dt2 = _q2[_q_pos];
				_q2[_q_pos] = 0.0;
				cur_buf2[i] = dt2;
			}
			
			if ( has_audio == 0 ){
				if ( Math.abs(dt) > 0.001 )has_audio = 1;
				else if ( stereo_mode == 1 ){
					if ( Math.abs(dt2) > 0.001 )has_audio = 1;
				}
			}
			
			_q_pos = ( _q_pos + 1 ) % qlen;
		}
		
		return has_audio;
	}
		
	function audiounit_push_pcm_from_notes(freqs, opts, delay_mss){
		if ( freqs.length <= 0 )return;
		let delay_frm_cnt = parseInt(( _sample_rate * 80 )/1000); //for stereo mode

		let stereo_now = _output_stereo_mode;
		let stereo_rnd = ( Math.random() < 0.5 ? 0 : 1 );
		
		for ( var f = 0; f < freqs.length; f++ ){
			let freq = freqs[f];
			let vol_x = 0.25, dur_x = 1.0;
		
			let opt2 = opts[f];
			if ( opt2 == 1 )dur_x = 0.5;	  		// Half note
			else if ( opt2 == 2 )dur_x = 0.25;		// Quarter note
			else if ( opt2 == 3 )vol_x = 0.125;		// Half volume
			else if ( opt2 == 4 )vol_x = 0.5;		// Double volume
			
			vol_x = parseFloat(vol_x * _volume);			
			if ( parseFloat(vol_x * freqs.length) > 1.0 )vol_x = parseFloat(1.0 / freqs.length);

			let cnt = parseInt((_sample_rate * _note_duration_ms * dur_x)/1000);
			
			let rad_per_sample = parseFloat((Math.PI*2.0*freq)/_sample_rate);			
			let ang_rad = 0.0, shape_rad = parseFloat(Math.PI/2);
			if ( stereo_now == 4 )shape_rad = parseFloat(Math.PI/4);
			else if ( stereo_now == 5 )shape_rad = parseFloat(Math.PI/3);
			let shape_rad_per_sample = parseFloat(( Math.PI - shape_rad )/cnt);
			let qlen = _q.length, dest_p = _q_pos;
			
			if ( delay_mss != null ){
//				console.log('delay_ms: ' + delay_mss[f]);
				if ( delay_mss[f] > 0 )dest_p += parseInt((_sample_rate * delay_mss[f])/1000);
			}
			
			for (var i = 0; i < cnt; i++, dest_p++, ang_rad += rad_per_sample, shape_rad += shape_rad_per_sample){
				let v = Math.sin(ang_rad);
				let amp = Math.sin(shape_rad);
				
				for ( var k = 0; k < _harmonic_amps.length; k++ ){
					if ( _harmonic_amps[k] >= 0.01 )v += Math.sin(ang_rad * (k+2)) * _harmonic_amps[k];
				}
				
				v = v * vol_x;
				if ( stereo_now < 1 ){
					_q[dest_p % qlen] += parseFloat(v * amp * amp * amp);
					continue;
				}
				
				let pp = dest_p % qlen;				
				if ( stereo_now == 2 ){
					let v1 = parseFloat(v * amp * amp * amp), v2 = parseFloat(v * amp);
					_q[pp] += ( stereo_rnd == 0 ? v1 : v2 );
					_q2[pp] += ( stereo_rnd == 0 ? v2 : v1 );
				}else if ( stereo_now == 3 ){
					let v1 = parseFloat(v * amp * amp * amp), pp2 = parseInt((pp + delay_frm_cnt)%qlen);
					_q[stereo_rnd == 0 ? pp : pp2] += v1;
					_q2[stereo_rnd == 0 ? pp2 : pp] += v1;
				}else if ( stereo_now == 4 ){
					let amp2 = parseFloat( amp > 0.707 ? ( 1.414 - amp ) : amp );
					_q[pp] += (stereo_rnd == 0 ? parseFloat(v * amp * amp * amp) : parseFloat(v * amp2 * amp2 * amp2));
					_q2[pp] += (stereo_rnd == 0 ? parseFloat(v * amp2 * amp2 * amp2) : parseFloat(v * amp * amp * amp));
				}else if ( stereo_now == 5 ){
					let amp2 = parseFloat( amp > 0.866 ? ( 1.732 - amp ) : amp );
					_q[pp] += (stereo_rnd == 0 ? parseFloat(v * amp * amp * amp) : parseFloat(v * amp2 * amp2 * amp2));
					_q2[pp] += (stereo_rnd == 0 ? parseFloat(v * amp2 * amp2 * amp2) : parseFloat(v * amp * amp * amp));
				}else{
					_q[pp] += parseFloat(v * amp * amp * amp);
					_q2[pp] += parseFloat(v * amp * amp * amp);
				}
			}
		}
	}

	function audiounit_play_notes(freqs, opts){
		if ( _initiated == 0 )audiounit_init();
		if ( freqs.length <= 0 )return;
		
		if ( _play_mode == 0 ){
			audiounit_push_pcm_from_notes(freqs, opts, null);
			audiounit_load_pcm_to_buffer(_buffer_full_notes[_buffer_full_notes_cur], parseInt((_sample_rate * _note_duration_ms)/1000));
			audiounit_play_buffer(_buffer_full_notes[_buffer_full_notes_cur], 0);
			_buffer_full_notes_cur = ( _buffer_full_notes_cur + 1 ) % _buffer_full_notes.length;			
		}else if ( _play_mode == 1 ){
			let t_ms = current_time_ms();			
			let p = _timer_note_q.length;
			for ( var i = 0; i < freqs.length; i++ ){
				_timer_note_q_opts[p] = opts[i];
				_note_request_ms[p] = t_ms;
				_timer_note_q[p++] = freqs[i];				
			}
			
			if ( _next_play_ms != 0 )return;
			t_ms = current_time_ms() + 60;
			if ( ( t_ms % 16 ) != 0 )t_ms += ( 16 - ( t_ms % 16 ));
			_next_play_ms = t_ms;
		}else if ( _play_mode == 2 ){
			let t_delay_ms = _event_frame_ms;
			if ( _event_state != 0 ){
				t_delay_ms = parseInt(current_time_ms() - _next_play_ms + _event_frame_ms);
				if ( t_delay_ms < 0 )t_delay_ms = 0;
				else if ( t_delay_ms > _event_frame_ms )t_delay_ms = _event_frame_ms;
			}
			
			for ( var i = 0; i < freqs.length; i++ )_note_request_ms[i] = t_delay_ms;
			audiounit_push_pcm_from_notes(freqs, opts, _note_request_ms);
			if ( _event_state != 0 )return;
			_event_state = 1;
			audiounit_load_pcm_to_buffer(_buffer_event, parseInt((_sample_rate * _event_frame_ms)/1000));
			audiounit_play_buffer(_buffer_event, 0);
		}
	}	

	function audiounit_update_continuous_notes(freqs){		
		if ( _initiated == 0 )audiounit_init();
		if ( _play_mode == 0 )return;
		if ( audiounit_is_continuous_tone_enabled() != 1 )return;
		
		let ff = [];
		for ( var i = 0; i < _continuous_note_q.length; i++ ){
			if ( _continuous_note_q[i] < 0 )continue;
			if ( freqs.indexOf(_continuous_note_q[i]) < 0 )_continuous_note_q[i] = parseInt(0 - _continuous_note_q[i]);
		}
		
		for ( var i = 0; i < freqs.length; i++ ){
			if ( _continuous_note_q.indexOf(freqs[i]) < 0 )_continuous_note_q[_continuous_note_q.length] = freqs[i];
		}
		
		if ( _play_mode == 1 ){
			if ( _next_play_ms != 0 )return;
			let t_ms = current_time_ms() + 60;
			if ( ( t_ms % 16 ) != 0 )t_ms += ( 16 - ( t_ms % 16 ));
			_next_play_ms = t_ms;
		}else if ( _play_mode == 2 ){			
			if ( _event_state != 0 )return;
			_event_state = 1;
			audiounit_push_continuous_notes();
			audiounit_load_pcm_to_buffer(_buffer_event, parseInt((_sample_rate * _event_frame_ms)/1000));
			audiounit_play_buffer(_buffer_event, 0);
		}
	}	
	
	function audiounit_push_continuous_notes(){
		if ( audiounit_is_continuous_tone_enabled() != 1 )return;
		if ( _play_mode != 1 && _play_mode != 2 )return;
		if ( _continuous_note_q.length <= 0 )return;
		
		let rnd2 = ( Math.random() < 0.5 ? 0 : 1 );
		
		let qlen = _q.length;
		let vmult = parseFloat(0.25 * _volume);
		if ( parseFloat( _continuous_note_q.length * vmult ) > 1.0 )vmult = parseFloat(1.0/_continuous_note_q.length);
		
		let sample_cnt = parseInt((_sample_rate * _timer_frame_ms)/1000);
		if ( _play_mode == 2 )sample_cnt = parseInt((_sample_rate * _event_frame_ms)/1000);
						
		for ( var p = _continuous_note_q.length - 1; p >= 0; p-- ){
			let freq = _continuous_note_q[p], tone_end = 0;
			if ( freq < 0 ){
				freq = parseInt(0 - freq);
				tone_end = 1;
				_continuous_note_q.splice(p,1);
			}				
			
			let cnt = sample_cnt;
			
			let rad_per_sample = parseFloat((Math.PI*2.0*freq)/_sample_rate);
			let shape_rad_per_sample = Math.PI/(cnt * 2.0);
			let ang_rad = rad_per_sample * _q_pos, shape_rad = Math.PI/2;
			
			if ( tone_end != 0 ){
				cnt = parseInt(cnt * 2);
				shape_rad_per_sample = parseFloat(shape_rad_per_sample/2);			
			}else{
				shape_rad = 0.0;
				shape_rad_per_sample = ( Math.PI * 2.0)/cnt;				
			}
			
			for (var i = 0; i < cnt; i++, ang_rad += rad_per_sample, shape_rad += shape_rad_per_sample){
				let v = Math.sin(ang_rad);
				let amp = Math.sin(shape_rad);
			
				for ( var k = 0; k < _harmonic_amps.length; k++ ){
					if ( _harmonic_amps[k] < 0.01 )continue;
					v += ( Math.sin(ang_rad * (k+2)) * _harmonic_amps[k] );
				}
				
				let pp = (_q_pos + i) % qlen;
				if ( _output_stereo_mode < 1 ){
					if ( tone_end == 0 )_q[pp] += parseFloat(v * vmult * (0.85 + 0.15 * amp ));
					else _q[pp] += parseFloat(v * vmult * amp);
					continue;
				}
				
				if ( tone_end != 0 ){
					_q[pp] += parseFloat(v * vmult * amp);
					_q2[pp] += parseFloat(v * vmult * amp);
					continue;
				}

				if ( _output_stereo_mode == 2 ){
					if ( rnd2 == 0 )amp = parseFloat(amp * 0.66);
					_q[pp] += parseFloat(v * vmult * (0.85 + 0.15 * amp ));
					_q2[pp] += parseFloat(v * vmult * (0.75 - 0.25 * amp ));
				}else if ( _output_stereo_mode == 3 ){
					let v1 = parseFloat(v * vmult * ( 0.60 + 0.30 * amp)), v2 = parseFloat(v * vmult * ( 0.75 - 0.20 * amp));
					_q[pp] += ( rnd2 == 0 ? v1 : v2 );
					_q2[pp] += ( rnd2 == 0 ? v2 : v1 );
				}else if ( _output_stereo_mode == 4 ){					
					let v1 = parseFloat(v * vmult * ( 0.65 + 0.35 * amp)), v2 = parseFloat(v * vmult * ( 0.65 - 0.15 * amp));
					_q[pp] += ( rnd2 == 0 ? v1 : v2 );
					_q2[pp] += ( rnd2 == 0 ? v2 : v1 );
				}else if ( _output_stereo_mode == 5 ){
					let v1 = parseFloat(v * vmult * ( 0.75 + 0.25 * amp)), v2 = parseFloat(v * vmult * ( 0.75 - 0.20 * amp));
					_q[pp] += ( rnd2 == 0 ? v1 : v2 );
					_q2[pp] += ( rnd2 == 0 ? v2 : v1 );
				}else{
					_q[pp] += parseFloat(v * vmult * (0.75 + 0.25 * amp ));
					_q2[pp] += parseFloat(v * vmult * (0.70 - 0.3 * amp ));
				}
			}			
		}
	}
