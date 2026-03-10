package=native_ccache
$(package)_version=4.11
$(package)_download_path=https://github.com/ccache/ccache/releases/download/v$($(package)_version)
$(package)_file_name=ccache-$($(package)_version).tar.gz
$(package)_sha256_hash=7dba208540dc61cedd5c93df8c960055a35f06e29a0a3cf766962251d4a5c766

define $(package)_set_vars
$(package)_config_opts=-DCMAKE_BUILD_TYPE=Release
$(package)_config_opts+=-DZSTD=OFF
$(package)_config_opts+=-DNO_GZIP=ON
endef

define $(package)_config_cmds
  cmake -B build -DCMAKE_INSTALL_PREFIX=$(build_prefix) $($(package)_config_opts)
endef

define $(package)_build_cmds
  $(MAKE) -C build
endef

define $(package)_stage_cmds
  $(MAKE) -C build install
endef
